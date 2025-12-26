import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ChatHistoryReader, WorkspaceInfo, ChatSession, ChatMessage } from './types';
import { Logger } from '../../utils/logger';
import { PlatformPaths } from '../../utils/platform-paths';

interface ClineConfig {
    id: string;
    name: string;
}

/**
 * Base class for Cline-family readers (Cline, Roo Code, Kilo Code).
 * Provides shared logic for reading chat history from these similar tools.
 */
export abstract class BaseClineReader implements ChatHistoryReader {
    protected readonly config: ClineConfig;

    constructor(config: ClineConfig) {
        this.config = config;
    }

    get name(): string {
        return this.config.name;
    }

    get description(): string {
        return '';
    }

    get extensionId(): string {
        return this.config.id;
    }

    async isAvailable(): Promise<boolean> {
        Logger.debug(`[${this.name}] Checking availability`);

        // Check both Stable and Insiders versions
        for (const baseDir of PlatformPaths.getVSCodeGlobalStoragePaths()) {
            try {
                const dir = path.join(baseDir, this.config.id);
                await fs.access(dir);
                Logger.debug(`[${this.name}] Found at: ${dir}`);
                return true;
            } catch {
                continue;
            }
        }

        Logger.debug(`[${this.name}] Not available in any VS Code version`);
        return false;
    }

    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        const workspaces: WorkspaceInfo[] = [];
        Logger.debug(`[${this.name}] getWorkspaces called`);

        // Check both Stable and Insiders versions
        for (const globalStorageBase of PlatformPaths.getVSCodeGlobalStoragePaths()) {
            const extensionDir = path.join(globalStorageBase, this.config.id);
            const tasksDir = path.join(extensionDir, 'tasks');

            try {
                await fs.access(tasksDir);
                const taskFolders = await fs.readdir(tasksDir);
                Logger.debug(`[${this.name}] Found ${taskFolders.length} task folders in ${globalStorageBase}`);

                // Group tasks by workspace
                const workspaceMap = new Map<string, { count: number, lastModified: number, path: string }>();

                for (const folder of taskFolders) {
                    const taskPath = path.join(tasksDir, folder);
                    const stats = await fs.stat(taskPath);
                    if (!stats.isDirectory()) continue;

                    const apiHistoryFile = path.join(taskPath, 'api_conversation_history.json');
                    try {
                        const content = await fs.readFile(apiHistoryFile, 'utf8');
                        const history = JSON.parse(content);

                        // Extract workspace path from environment_details in the first message
                        const wsPath = this.extractWorkspacePath(history);
                        if (wsPath) {
                            const existing = workspaceMap.get(wsPath);
                            if (!existing || stats.mtimeMs > existing.lastModified) {
                                workspaceMap.set(wsPath, {
                                    count: (existing?.count || 0) + 1,
                                    lastModified: Math.max(existing?.lastModified || 0, stats.mtimeMs),
                                    path: extensionDir // Store the extension dir as base
                                });
                            } else {
                                existing.count++;
                            }
                        }
                    } catch (e) {
                        // If we can't read api history, we might still want to count it as "Unknown Workspace"
                        const wsPath = 'Unknown Workspace';
                        const existing = workspaceMap.get(wsPath);
                        workspaceMap.set(wsPath, {
                            count: (existing?.count || 0) + 1,
                            lastModified: Math.max(existing?.lastModified || 0, stats.mtimeMs),
                            path: extensionDir
                        });
                    }
                }

                for (const [wsPath, info] of workspaceMap.entries()) {
                    Logger.debug(`[${this.name}] Adding workspace: ${wsPath} (${info.count} chats)`);
                    workspaces.push({
                        id: `${this.config.id}:${wsPath}`,
                        name: wsPath === 'Unknown Workspace' ? `${this.name} (Unknown)` : `${this.name}: ${path.basename(wsPath)}`,
                        path: wsPath,  // Use real path for matching
                        dbPath: JSON.stringify({ extensionDir: info.path, wsPath }), // Store metadata in dbPath
                        lastModified: info.lastModified,
                        chatCount: info.count,
                        source: this.name
                    });
                }

            } catch (error) {
                // Extension dir doesn't exist in this location, try next
                continue;
            }
        }

        Logger.debug(`[${this.name}] Total workspaces found: ${workspaces.length}`);
        return workspaces.sort((a, b) => b.lastModified - a.lastModified);
    }

    async getSessions(workspaceDbPath: string): Promise<ChatSession[]> {
        Logger.debug(`[${this.name}] getSessions called with dbPath: ${workspaceDbPath}`);
        // Parse metadata from dbPath (which contains the JSON structure)
        const { extensionDir, wsPath } = JSON.parse(workspaceDbPath);
        const tasksDir = path.join(extensionDir, 'tasks');
        const sessions: ChatSession[] = [];

        try {
            const taskFolders = await fs.readdir(tasksDir);

            // Parallelize processing of task folders
            const sessionPromises = taskFolders.map(async (folder) => {
                const taskPath = path.join(tasksDir, folder);
                try {
                    const stats = await fs.stat(taskPath);
                    if (!stats.isDirectory()) return null;

                    const apiHistoryFile = path.join(taskPath, 'api_conversation_history.json');

                    // Only read API history to filter by workspace (lightweight check)
                    try {
                        const apiContent = await fs.readFile(apiHistoryFile, 'utf8');
                        const history = JSON.parse(apiContent);

                        const extractedWsPath = this.extractWorkspacePath(history);
                        if (extractedWsPath !== wsPath && wsPath !== 'Unknown Workspace') return null;
                    } catch {
                        return null; // Skip if API history is unreadable
                    }

                    // Quick title extraction: read first user message from ui_messages.json
                    let title = folder.slice(0, 8) + '...'; // Fallback
                    try {
                        const uiMessagesFile = path.join(taskPath, 'ui_messages.json');
                        const uiContent = await fs.readFile(uiMessagesFile, 'utf8');
                        const uiMessages = JSON.parse(uiContent);

                        // Find the first user message (type='say', say='text', has 'images' field)
                        const firstUserMsg = uiMessages.find((msg: any) =>
                            msg.type === 'say' && msg.say === 'text' && 'images' in msg && msg.text
                        );

                        if (firstUserMsg?.text) {
                            title = firstUserMsg.text.slice(0, 50); // Use first 50 chars as title
                        }
                    } catch {
                        // If we can't read ui_messages, keep the folder-based fallback
                    }

                    // Use folder's birth time as stable creation timestamp
                    // This matches the first message time and never changes
                    const session: ChatSession = {
                        id: folder,
                        title: title,
                        description: `Task folder (lazy load)`,
                        timestamp: stats.birthtimeMs, // Stable creation time
                        lastUpdatedAt: stats.mtimeMs,  // Changes when task is updated
                        messages: [], // Lazy load via fetchSessionContent
                        source: this.name,  // Use reader name so SyncManager can find this reader
                        metadata: { subChannel: this.name }  // Store specific subchannel
                    };

                    return session;

                } catch (e) {
                    return null;
                }
            });

            const results = await Promise.all(sessionPromises);
            sessions.push(...results.filter((s): s is ChatSession => s !== null));

        } catch (error) {
            Logger.error(`[${this.name}] Failed to read sessions`, error);
        }

        return sessions.sort((a, b) => b.timestamp - a.timestamp);
    }

    async fetchSessionContent(sessionId: string, workspaceDbPath: string): Promise<ChatMessage[]> {
        try {
            const { extensionDir } = JSON.parse(workspaceDbPath);
            const taskPath = path.join(extensionDir, 'tasks', sessionId);
            const uiMessagesFile = path.join(taskPath, 'ui_messages.json');

            Logger.debug(`[${this.name}] Reading ui_messages from: ${uiMessagesFile}`);
            const uiContent = await fs.readFile(uiMessagesFile, 'utf8');
            const uiMessages = JSON.parse(uiContent);
            Logger.debug(`[${this.name}] Found ${uiMessages.length} raw messages`);

            const messages: ChatMessage[] = [];

            for (const msg of uiMessages) {
                if (msg.type === 'say' && (msg.say === 'text' || msg.say === 'completion_result' || msg.say === 'user_feedback')) {
                    // Distinguish user vs assistant by presence of 'images' field or 'user_feedback' type
                    if ('images' in msg || msg.say === 'user_feedback') {
                        // User message
                        Logger.debug(`[${this.name}] User message (${msg.say}): ${msg.text?.substring(0, 50)}`);
                        messages.push({
                            role: 'user',
                            content: msg.text,
                            timestamp: msg.ts
                        });
                    } else {
                        // Assistant message (both 'text' and 'completion_result')
                        if (msg.text) {
                            Logger.debug(`[${this.name}] Assistant message (${msg.say}): ${msg.text?.substring(0, 50)}`);
                            messages.push({
                                role: 'assistant',
                                content: msg.text,
                                timestamp: msg.ts
                            });
                        }
                    }
                } else if (msg.type === 'ask' && msg.text) {
                    let content = msg.text;
                    try {
                        const parsed = JSON.parse(msg.text);
                        if (parsed.question) content = parsed.question;
                    } catch { }

                    Logger.debug(`[${this.name}] Ask message: ${content?.substring(0, 50)}`);
                    messages.push({
                        role: 'assistant',
                        content: content,
                        timestamp: msg.ts,
                        metadata: { isQuestion: true }
                    });
                }
            }

            Logger.debug(`[${this.name}] Parsed ${messages.length} messages from ${uiMessages.length} raw messages`);
            return messages;

        } catch (error) {
            Logger.error(`[${this.name}] Failed to fetch content for session ${sessionId}`, error);
            return [];
        }
    }

    private extractWorkspacePath(history: any[]): string | null {
        if (!history || history.length === 0) return null;
        const firstMsg = history[0];
        if (firstMsg.role === 'user' && Array.isArray(firstMsg.content)) {
            for (const item of firstMsg.content) {
                if (item.type === 'text' && (item.text.includes('Workspace Directory') || item.text.includes('Working Directory'))) {
                    const match = item.text.match(/Current (?:Workspace|Working) Directory \((.*?)\)/);
                    if (match) return match[1];
                }
            }
        }
        return null;
    }
}
