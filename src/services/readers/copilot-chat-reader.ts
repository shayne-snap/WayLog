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

    /**
     * Remove Copilot's thinking process markers from response text.
     * Copilot often includes verbose internal reasoning like:
     * **Planning todo list**
     * I need to use the todo list tool...
     * 
     * This method removes these sections, keeping only the final answer.
     */
    private removeThinkingProcess(text: string): string {
        // Pattern: **Title** followed by paragraphs until next **Title** or end
        // This matches sections like:
        // **Planning todo list**\n\nI need to...\n\n**Gathering details**\n\nI will...

        // Split by double newlines to get paragraphs
        const paragraphs = text.split('\n\n');
        const filtered: string[] = [];
        let skipNext = false;

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];

            // Check if this is a thinking process marker (starts with **Title**)
            if (/^\*\*[A-Z][a-z]+(?:\s+[a-z]+)*\*\*\s*$/.test(para.trim())) {
                // This is a section header, skip it and the next paragraph
                skipNext = true;
                continue;
            }

            if (skipNext) {
                // Skip the content paragraph after a thinking marker
                skipNext = false;
                continue;
            }

            // Keep this paragraph
            filtered.push(para);
        }

        const result = filtered.join('\n\n').trim();
        return result;
    }

    // Override isAvailable to add logging
    async isAvailable(): Promise<boolean> {
        try {
            const workspaces = await this.getWorkspaces();
            return workspaces.length > 0;
        } catch (e) {
            Logger.error(`[CopilotChatReader] isAvailable failed`, e);
            return false;
        }
    }

    // Override getWorkspaces to check both Stable and Insiders
    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        const allWorkspaces: WorkspaceInfo[] = [];
        const storageDirs = this.getStorageDirs();

        for (const storageDir of storageDirs) {

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
            } catch (e) {
                continue;
            }
        }

        return allWorkspaces.sort((a, b) => b.lastModified - a.lastModified);
    }

    async getSessions(dbPath: string): Promise<ChatSession[]> {
        try {
            const workspacePath = path.dirname(dbPath);
            const chatSessionsDir = path.join(workspacePath, 'chatSessions');

            try {
                await fs.access(chatSessionsDir);
            } catch {
                return [];
            }

            const files = await fs.readdir(chatSessionsDir);
            const jsonFiles = files.filter(f => f.endsWith('.json'));

            const sessionPromises = jsonFiles.map(async (file): Promise<ChatSession | null> => {
                const sessionId = path.basename(file, '.json');
                const sessionFile = path.join(chatSessionsDir, file);

                try {
                    // Removed size check to ensure accuracy, sacrificing some performance
                    // const stats = await fs.stat(sessionFile);
                    // if (stats.size < 2000) return null;

                    const content = await fs.readFile(sessionFile, 'utf8');
                    const sessionData = JSON.parse(content);
                    const messages: ChatMessage[] = [];

                    // Parse requests (user) and responses (ai)
                    const requests = sessionData.requests || [];

                    for (const req of requests) {
                        const timestamp = req.timestamp || sessionData.creationDate || Date.now();

                        // Add User message
                        if (req.message?.text || req.userRequest?.text) {
                            messages.push({
                                role: 'user',
                                content: req.message?.text || req.userRequest?.text || '',
                                timestamp: timestamp
                            });
                        }

                        // Add AI response
                        const response = req.response || [];
                        let responseText = '';

                        // Handle new format with separate parts
                        if (Array.isArray(response)) {
                            responseText = response
                                .map((r: any) => {
                                    if (r.kind === 'thinking') return ''; // Skip thinking blocks
                                    return r.value || r.response || '';
                                })
                                .filter(Boolean)
                                .join('\n');
                        } else {
                            // Fallback for older formats
                            responseText = typeof response === 'string' ? response : (response.value || '');
                        }

                        // Also apply text-based filtering just in case
                        responseText = this.removeThinkingProcess(responseText);

                        if (responseText) {
                            messages.push({
                                role: 'assistant',
                                content: responseText,
                                timestamp: timestamp + 1000 // Ensure AI message comes after user
                            });
                        }
                    }

                    if (messages.length > 0) {
                        return {
                            id: sessionId,
                            title: messages[0].content.slice(0, 50),
                            description: `Copilot Chat: ${messages.length} messages`,
                            timestamp: sessionData.lastMessageDate || sessionData.creationDate || Date.now(),
                            lastUpdatedAt: sessionData.lastMessageDate || Date.now(),
                            messages: messages,
                            source: this.name
                        };
                    }
                } catch (e) {
                    Logger.error(`[CopilotChatReader] Failed to parse session file ${file}`, e);
                }
                return null;
            });

            const results = await Promise.all(sessionPromises);

            const sessions: ChatSession[] = results.filter((s): s is ChatSession => s !== null);
            sessions.sort((a, b) => b.timestamp - a.timestamp);

            return sessions;
        } catch (error) {
            Logger.error(`[CopilotChatReader] Failed to get sessions`, error);
            return [];
        }
    }
}

function reqsToAgent(requests: any[]): string {
    if (!requests || requests.length === 0) return 'Unknown';
    const agents = new Set(requests.map(r => r.agent?.id).filter(Boolean));
    return Array.from(agents).join(', ') || 'Copilot/Internal';
}
