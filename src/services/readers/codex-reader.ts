import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ChatHistoryReader, WorkspaceInfo, ChatSession, ChatMessage } from './types';
import { Logger } from '../../utils/logger';

export class CodexReader implements ChatHistoryReader {
    public readonly name = 'OpenAI Codex';
    public readonly description = '';
    public readonly extensionId = 'openai.chatgpt'; // Best effort match for official plugin

    async isAvailable(): Promise<boolean> {
        const codexDir = path.join(os.homedir(), '.codex/sessions');
        try {
            await fs.access(codexDir);
            return true;
        } catch {
            return false;
        }
    }

    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        const workspaces: WorkspaceInfo[] = [];
        const sessionsDir = path.join(os.homedir(), '.codex/sessions');

        try {
            const files = await this.findJsonlFiles(sessionsDir);
            const workspaceMap = new Map<string, { count: number, lastModified: number }>();

            for (const file of files) {
                const stats = await fs.stat(file);
                const info = await this.peekSessionInfo(file);

                if (info.cwd) {
                    const wsPath = info.cwd;
                    const existing = workspaceMap.get(wsPath);
                    workspaceMap.set(wsPath, {
                        count: (existing?.count || 0) + 1,
                        lastModified: Math.max(existing?.lastModified || 0, stats.mtimeMs)
                    });
                }
            }

            for (const [wsPath, info] of workspaceMap.entries()) {
                workspaces.push({
                    id: `codex:${wsPath}`,
                    name: `Codex: ${path.basename(wsPath)}`,
                    path: wsPath,
                    lastModified: info.lastModified,
                    chatCount: info.count,
                    source: 'OpenAI Codex'
                });
            }
        } catch (error) {
            Logger.error('[CodexReader] Failed to get workspaces', error);
        }

        return workspaces.sort((a, b) => b.lastModified - a.lastModified);
    }

    async getSessions(workspacePath: string): Promise<ChatSession[]> {
        const sessions: ChatSession[] = [];
        const sessionsDir = path.join(os.homedir(), '.codex/sessions');

        try {
            const files = await this.findJsonlFiles(sessionsDir);
            for (const file of files) {
                const stats = await fs.stat(file);
                const sessionData = await this.parseSessionFile(file);

                if (sessionData.cwd === workspacePath && sessionData.messages.length > 0) {
                    // Use first message timestamp as creation time for stable filename
                    const creationTime = sessionData.messages.length > 0 ? sessionData.messages[0].timestamp : stats.mtimeMs;

                    sessions.push({
                        id: path.basename(file),
                        title: sessionData.title || 'Codex Session',
                        description: `${sessionData.messages.length} messages`,
                        timestamp: creationTime || stats.mtimeMs, // Fallback if 0/undefined
                        lastUpdatedAt: stats.mtimeMs,
                        messages: sessionData.messages,
                        source: 'OpenAI Codex'
                    });
                }
            }
        } catch (error) {
            Logger.error('[CodexReader] Failed to get sessions', error);
        }

        return sessions.sort((a, b) => b.timestamp - a.timestamp);
    }

    private async findJsonlFiles(dir: string): Promise<string[]> {
        const results: string[] = [];
        const list = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of list) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...(await this.findJsonlFiles(fullPath)));
            } else if (entry.name.endsWith('.jsonl')) {
                results.push(fullPath);
            }
        }
        return results;
    }

    private async peekSessionInfo(filePath: string): Promise<{ cwd?: string }> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                const entry = JSON.parse(line);
                if (entry.type === 'turn_context' && entry.payload?.cwd) {
                    return { cwd: entry.payload.cwd };
                }
            }
        } catch { }
        return {};
    }

    private async parseSessionFile(filePath: string): Promise<{ cwd?: string, messages: ChatMessage[], title?: string }> {
        const messages: ChatMessage[] = [];
        let cwd: string | undefined;
        let title: string | undefined;

        try {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const entry = JSON.parse(line);
                    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

                    if (entry.type === 'turn_context' && entry.payload?.cwd) {
                        cwd = entry.payload.cwd;
                    }

                    if (entry.type === 'response_item' && entry.payload?.type === 'message') {
                        const role = entry.payload.role;
                        const contentArray = entry.payload.content;
                        let textContent = '';

                        if (Array.isArray(contentArray)) {
                            for (const part of contentArray) {
                                if (part.type === 'input_text' || part.type === 'text') {
                                    // Skip the massive INSTRUCTIONS and environment_context blocks for cleaner output
                                    if (part.text.includes('<INSTRUCTIONS>') || part.text.includes('<environment_context>')) continue;
                                    textContent += part.text;
                                }
                            }
                        }

                        if (textContent.trim()) {
                            if (role === 'user' && !title) title = textContent.trim().slice(0, 50);
                            messages.push({
                                role: role as 'user' | 'assistant',
                                content: textContent.trim(),
                                timestamp: ts
                            });
                        }
                    } else if (entry.type === 'event_msg' && entry.payload?.type === 'user_message') {
                        // Sometimes user messages come in event_msg
                        const text = entry.payload.message;
                        if (text && !messages.some(m => m.content === text.trim())) {
                            if (!title) title = text.trim().slice(0, 50);
                            messages.push({
                                role: 'user',
                                content: text.trim(),
                                timestamp: ts
                            });
                        }
                    } else if (entry.type === 'event_msg' && entry.payload?.type === 'error') {
                        // Capture Errors
                        const errorMsg = entry.payload.message || 'Unknown Error';
                        messages.push({
                            role: 'assistant',
                            content: `⚠️ **Codex Error**: ${errorMsg}`,
                            timestamp: ts
                        });
                    }
                } catch (e) { }
            }
        } catch (e) { }

        return { cwd, messages, title };
    }
}
