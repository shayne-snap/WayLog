import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseVscdbReader } from './base-vscdb-reader';
import { ChatSession, ChatMessage } from './types';
import { Logger } from '../../utils/logger';

export class CopilotChatReader extends BaseVscdbReader {
    public readonly name = 'Copilot Chat';
    public readonly description = '';
    public readonly extensionId = 'github.copilot-chat';

    // We override storageBaseDir to dynamically handle both Insiders and Stable
    get storageBaseDir(): string {
        const appData = process.platform === 'darwin'
            ? path.join(process.env.HOME || '', 'Library/Application Support')
            : process.env.APPDATA || '';

        // We'll primarily target Insiders as it's what the user is using, 
        // but a more robust implementation would check both.
        return path.join(appData, 'Code - Insiders/User/workspaceStorage');
    }

    get chatDataKey(): string {
        return 'chat.ChatSessionStore.index';
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
