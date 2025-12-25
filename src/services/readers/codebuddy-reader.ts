import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChatHistoryReader, ChatSession, ChatMessage, WorkspaceInfo } from './types';
import { Logger } from '../../utils/logger';
import { PlatformPaths } from '../../utils/platform-paths';

interface CodeBuddyProjectIndex {
    conversations: {
        id: string;
        type: string;
        name: string;
        createdAt: string;
        lastMessageAt: string;
    }[];
    current: string;
}

interface CodeBuddySessionIndex {
    messages: {
        id: string;
        role: 'user' | 'assistant';
        type: string;
    }[];
}

interface CodeBuddyMessage {
    role: 'user' | 'assistant';
    message: string; // Stringified JSON
    id: string;
    extra?: string;
}

export class CodeBuddyReader implements ChatHistoryReader {
    public readonly name = 'Tencent CodeBuddy';
    public readonly description = '';
    public readonly extensionId = 'tencent-cloud.coding-copilot';
    private historyPaths: string[] = [];

    constructor() {
        this.initializePaths();
    }

    private initializePaths() {
        // TODO: Verify Windows path for CodeBuddy. Currently mapped to standard AppData structure.
        const baseDir = PlatformPaths.getCodeBuddyDataPath();
        if (!fs.existsSync(baseDir)) {
            Logger.debug('[CodeBuddyReader] CodeBuddy data directory not found at ' + baseDir);
            return;
        }

        try {
            this.findHistoryDirs(baseDir);
            Logger.debug(`[CodeBuddyReader] Found ${this.historyPaths.length} history directories`);
        } catch (error) {
            Logger.error('[CodeBuddyReader] Error scanning CodeBuddy paths', error);
        }
    }

    private findHistoryDirs(currentDir: string, depth = 0) {
        if (depth > 6) return;

        try {
            const files = fs.readdirSync(currentDir);
            for (const file of files) {
                const fullPath = path.join(currentDir, file);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    if (file === 'history') {
                        this.historyPaths.push(fullPath);
                    } else {
                        // avoid scanning huge node_modules or similar if any
                        this.findHistoryDirs(fullPath, depth + 1);
                    }
                }
            }
        } catch (e) { }
    }

    private getProjectHash(projectPath: string): string {
        return crypto.createHash('md5').update(projectPath).digest('hex');
    }

    async isAvailable(): Promise<boolean> {
        return this.historyPaths.length > 0;
    }

    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        const workspaces: WorkspaceInfo[] = [];

        // 1. Map current VS Code workspaces
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const fsPath = folder.uri.fsPath;
                const md5 = this.getProjectHash(fsPath);

                // Check if this MD5 exists in any of the known history paths
                for (const historyPath of this.historyPaths) {
                    const projectHistoryPath = path.join(historyPath, md5);
                    if (fs.existsSync(projectHistoryPath) && fs.statSync(projectHistoryPath).isDirectory()) {

                        // Count chats in this specific project
                        const sessions = await this.getSessions(projectHistoryPath);

                        workspaces.push({
                            id: `codebuddy-${md5}`,
                            name: `CodeBuddy (${folder.name})`,
                            path: fsPath, // This matches the VS Code workspace path for AutoSync
                            dbPath: projectHistoryPath, // This points to the actual data folder
                            lastModified: Date.now(), // approximation, or take from sessions
                            chatCount: sessions.length,
                            source: this.name
                        });
                    }
                }
            }
        }

        // 2. Also return raw discovered workspaces (existing logic)
        // These won't match AutoSync for current project, but good for listing in UI
        for (const historyPath of this.historyPaths) {
            const parts = historyPath.split(path.sep);
            const vscodeIndex = parts.lastIndexOf('VSCode');
            const ideIndex = parts.lastIndexOf('CodeBuddyIDE');
            const type = vscodeIndex > -1 ? 'VSCode' : (ideIndex > -1 ? 'IDE' : 'Unknown');

            try {
                // Determine if this history path was already covered by a mapped workspace
                // (Optimization: skip if we want, but for now let's keep it simple)

                const sessions = await this.getSessions(historyPath);
                if (sessions.length > 0) {
                    workspaces.push({
                        id: historyPath,
                        name: `CodeBuddy Raw (${type}) - ${path.basename(path.dirname(path.dirname(historyPath)))}`,
                        path: historyPath,
                        lastModified: sessions.length > 0 ? Math.max(...sessions.map(s => s.timestamp)) : 0,
                        chatCount: sessions.length,
                        source: this.name
                    });
                }
            } catch (e) {
                Logger.error(`[CodeBuddyReader] Failed to scan workspace ${historyPath}`, e);
            }
        }

        // internal dedup based on ID could be useful, but let's just return all
        return workspaces.sort((a, b) => b.lastModified - a.lastModified);
    }

    async getSessions(workspacePath: string): Promise<ChatSession[]> {
        const sessions: ChatSession[] = [];

        // Determine if workspacePath is a specific project (MD5) or a history root
        // MD5 is 32 hex chars. history root is named 'history'.
        const isProjectDir = /^[a-f0-9]{32}$/i.test(path.basename(workspacePath));

        try {
            if (isProjectDir) {
                await this.scanProjectDir(workspacePath, sessions);
            } else {
                // Assume it's a history root containing project directories
                const projectDirs = fs.readdirSync(workspacePath);
                for (const projectDir of projectDirs) {
                    const projectPath = path.join(workspacePath, projectDir);
                    if (!fs.statSync(projectPath).isDirectory()) continue;
                    await this.scanProjectDir(projectPath, sessions);
                }
            }
        } catch (e) {
            Logger.error(`[CodeBuddyReader] Failed to read sessions from ${workspacePath}`, e);
        }

        return sessions.sort((a, b) => b.timestamp - a.timestamp);
    }

    private async scanProjectDir(projectPath: string, sessions: ChatSession[]) {
        try {
            // Read project-level index.json to get stable timestamps
            const projectIndexPath = path.join(projectPath, 'index.json');
            let projectIndex: CodeBuddyProjectIndex | undefined;

            if (fs.existsSync(projectIndexPath)) {
                try {
                    projectIndex = JSON.parse(fs.readFileSync(projectIndexPath, 'utf-8'));
                } catch (e) {
                    Logger.error(`[CodeBuddyReader] Failed to parse project index: ${projectIndexPath}`, e);
                }
            }

            // Map session ID to creation time
            const sessionTimestamps = new Map<string, number>();
            if (projectIndex && projectIndex.conversations) {
                for (const conv of projectIndex.conversations) {
                    sessionTimestamps.set(conv.id, new Date(conv.createdAt).getTime());
                }
            }

            const sessionDirs = fs.readdirSync(projectPath);
            for (const sessionDir of sessionDirs) {
                const sessionPath = path.join(projectPath, sessionDir);
                if (!fs.statSync(sessionPath).isDirectory()) continue;

                // Check for session level index.json
                const indexPath = path.join(sessionPath, 'index.json');
                if (fs.existsSync(indexPath)) {
                    const messages = await this.readMessages(sessionPath);
                    if (messages.length === 0) continue;

                    const stats = fs.statSync(indexPath);

                    // Use stable creation time if available, otherwise fallback to mtime
                    const creationTime = sessionTimestamps.get(sessionDir) || stats.mtimeMs;

                    sessions.push({
                        id: `${path.basename(projectPath)}/${sessionDir}`, // Unique ID: MD5/SessionID
                        title: this.generateTitle(messages),
                        description: `${messages.length} messages`,
                        timestamp: creationTime,
                        lastUpdatedAt: stats.mtimeMs,
                        messages: messages,
                        source: this.name
                    });
                }
            }
        } catch (e) {
            // ignore access errors
        }
    }

    private generateTitle(messages: ChatMessage[]): string {
        // Find first valid user message that isn't just metadata
        for (const msg of messages) {
            if (msg.role === 'user') {
                const clean = msg.content.trim();
                if (clean.length > 0) {
                    return clean.slice(0, 50).replace(/\n/g, ' ');
                }
            }
        }
        return 'New Chat';
    }

    private async readMessages(sessionPath: string): Promise<ChatMessage[]> {
        const indexPath = path.join(sessionPath, 'index.json');

        try {
            const indexContent = fs.readFileSync(indexPath, 'utf-8');
            const indexData: CodeBuddySessionIndex = JSON.parse(indexContent);
            const messagesPath = path.join(sessionPath, 'messages');

            const messages: ChatMessage[] = [];

            if (!indexData.messages) return [];

            for (const msgRef of indexData.messages) {
                const msgFile = path.join(messagesPath, `${msgRef.id}.json`);
                if (fs.existsSync(msgFile)) {
                    try {
                        const msgRaw: CodeBuddyMessage = JSON.parse(fs.readFileSync(msgFile, 'utf-8'));

                        // message field is a stringified JSON
                        let msgContent: any;
                        try {
                            msgContent = JSON.parse(msgRaw.message);
                        } catch {
                            msgContent = { content: msgRaw.message };
                        }

                        let text = '';
                        // CodeBuddy structure: content can be array of {type:'text', text:'...'} or string
                        if (msgContent && Array.isArray(msgContent.content)) {
                            text = msgContent.content
                                .filter((c: any) => c.type === 'text')
                                .map((c: any) => c.text)
                                .join('\n');
                        } else if (msgContent && typeof msgContent.content === 'string') {
                            text = msgContent.content;
                        } else if (typeof msgContent === 'string') {
                            text = msgContent;
                        }

                        text = this.cleanContent(text);

                        if (text) {
                            messages.push({
                                role: msgRef.role as 'user' | 'assistant',
                                content: text,
                                timestamp: fs.statSync(msgFile).mtimeMs,
                                metadata: {
                                    model: msgContent.model || undefined
                                }
                            });
                        }
                    } catch (e) {
                        // Skip malformed individual messages
                    }
                }
            }

            return messages;
        } catch (e) {
            return [];
        }
    }

    private cleanContent(content: string): string {
        if (!content) return '';
        let cleaned = content;
        cleaned = cleaned.replace(/<user_info>[\s\S]*?<\/user_info>/g, '');
        cleaned = cleaned.replace(/<project_context>[\s\S]*?<\/project_context>/g, '');
        cleaned = cleaned.replace(/<project_layout>[\s\S]*?<\/project_layout>/g, '');
        cleaned = cleaned.replace(/<system_reminder>[\s\S]*?<\/system_reminder>/g, '');
        cleaned = cleaned.replace(/<user_query>/g, '');
        cleaned = cleaned.replace(/<\/user_query>/g, '');

        // Remove additional metadata tags
        cleaned = cleaned.replace(/<additional_data>[\s\S]*?<\/additional_data>/g, '');
        cleaned = cleaned.replace(/<currently_opened_file>[\s\S]*?<\/currently_opened_file>/g, '');

        return cleaned.trim();
    }
}
