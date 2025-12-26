import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseVscdbReader } from './base-vscdb-reader';
import { ChatSession, ChatMessage, WorkspaceInfo } from './types';
import { Logger } from '../../utils/logger';
import { PlatformPaths } from '../../utils/platform-paths';

export class CopilotChatReader extends BaseVscdbReader {
    public readonly name = 'Copilot Chat';
    public readonly description = '';
    public readonly extensionId = 'github.copilot-chat';

    // Override to return default storage location (Stable version)
    get storageBaseDir(): string {
        return PlatformPaths.getVSCodeWorkspaceStoragePaths()[0];
    }

    // Return all possible storage directories to check (Stable + Insiders)
    private getStorageDirs(): string[] {
        return PlatformPaths.getVSCodeWorkspaceStoragePaths();
    }

    get chatDataKey(): string {
        return 'chat.ChatSessionStore.index';
    }

    // Override getWorkspaces to check both Stable and Insiders
    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        const allWorkspaces: WorkspaceInfo[] = [];

        for (const storageDir of this.getStorageDirs()) {
            try {
                await fs.access(storageDir);
                const hasFolders = await fs.readdir(storageDir);

                for (const folder of hasFolders) {
                    const workspacePath = path.join(storageDir, folder);
                    const dbPath = path.join(workspacePath, 'state.vscdb');

                    try {
                        await fs.access(dbPath);
                        const stats = await fs.stat(dbPath);

                        // Try to resolve workspace name and path from workspace.json
                        const details = await this.resolveWorkspaceDetails(workspacePath);

                        // Check if there's actually chat data in this DB
                        const chatCount = await this.countChatSessions(dbPath);

                        if (chatCount > 0) {
                            allWorkspaces.push({
                                id: folder,
                                name: details.name || `Workspace ${folder.slice(0, 6)}`,
                                path: details.path || dbPath,
                                dbPath: dbPath,
                                lastModified: stats.mtimeMs,
                                chatCount: chatCount,
                                source: this.name
                            });
                        }
                    } catch {
                        continue; // Skip folders without state.vscdb
                    }
                }
            } catch {
                // Storage directory doesn't exist, skip it
                continue;
            }
        }

        return allWorkspaces.sort((a, b) => b.lastModified - a.lastModified);
    }

    async getSessions(dbPath: string): Promise<ChatSession[]> {
        try {
            const indexValue = await this.getTableValue(dbPath, 'ItemTable', this.chatDataKey);
            if (!indexValue) return [];

            const indexData = JSON.parse(indexValue);
            const sessions: ChatSession[] = [];
            const workspacePath = path.dirname(dbPath);
            const chatSessionsDir = path.join(workspacePath, 'chatSessions');

            // The index tells us which sessions exist
            const entries = indexData.entries || {};
            for (const sessionId of Object.keys(entries)) {
                const entry = entries[sessionId];
                const sessionFile = path.join(chatSessionsDir, `${sessionId}.json`);

                try {
                    const content = await fs.readFile(sessionFile, 'utf8');
                    const sessionData = JSON.parse(content);
                    const messages: ChatMessage[] = [];

                    // Parse requests (user) and responses (ai)
                    const requests = sessionData.requests || [];
                    for (const req of requests) {
                        // Add User message
                        if (req.message?.text || req.userRequest?.text) {
                            messages.push({
                                role: 'user',
                                content: req.message?.text || req.userRequest?.text || '',
                                timestamp: req.timestamp || entry.lastMessageDate
                            });
                        }

                        // Add AI response
                        const response = req.response || [];
                        const responseText = response.map((r: any) => r.response || r.value || '').join('\n');
                        if (responseText) {
                            // Identify the agent for a more informative source
                            const agentId = req.agent?.id || 'assistant';
                            messages.push({
                                role: 'assistant',
                                content: responseText,
                                timestamp: req.timestamp || entry.lastMessageDate,
                                // Metadata about who replied
                                metadata: { agent: agentId }
                            });
                        }
                    }

                    if (messages.length > 0) {
                        sessions.push({
                            id: sessionId,
                            title: entry.title || messages[0].content.slice(0, 50),
                            description: `Agent: ${reqsToAgent(sessionData.requests)}`,
                            // Fix: Use creationDate from session file for stable filename generation
                            // This prevents duplicate files when new messages are added to the session
                            timestamp: sessionData.creationDate || entry.lastMessageDate || Date.now(),
                            messages: messages,
                            source: this.name
                        });
                    }
                } catch (e) {
                    Logger.info(`[VscodeNativeReader] Session file not found or unreadable: ${sessionId}`);
                    continue;
                }
            }

            return sessions.sort((a, b) => b.timestamp - a.timestamp);
        } catch (error) {
            Logger.error(`[VscodeNativeReader] Failed to parse sessions`, error);
            return [];
        }
    }
}

function reqsToAgent(requests: any[]): string {
    if (!requests || requests.length === 0) return 'Unknown';
    const agents = new Set(requests.map(r => r.agent?.id).filter(Boolean));
    return Array.from(agents).join(', ') || 'Copilot/Internal';
}
