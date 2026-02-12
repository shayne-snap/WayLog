import * as fs from 'fs/promises';
import * as path from 'path';
import { ChatHistoryReader, WorkspaceInfo, ChatSession, ChatMessage } from './types';
import { PlatformPaths } from '../../utils/platform-paths';
import { Logger } from '../../utils/logger';

export class KiroReader implements ChatHistoryReader {
    public readonly name = 'Kiro';
    public readonly description = 'Chat history from Kiro IDE';

    private getKiroBasePath(): string {
        return path.join(PlatformPaths.getAppDataPath(), 'Kiro');
    }

    private getSessionsBasePath(): string {
        return path.join(
            this.getKiroBasePath(), 'User', 'globalStorage',
            'kiro.kiroagent', 'workspace-sessions'
        );
    }

    async isAvailable(): Promise<boolean> {
        const p = this.getSessionsBasePath();
        try {
            await fs.access(p);
            Logger.info(`[KiroReader] Available at ${p}`);
            return true;
        } catch {
            Logger.info(`[KiroReader] Not available at ${p}`);
            return false;
        }
    }

    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        const basePath = this.getSessionsBasePath();
        const workspaces: WorkspaceInfo[] = [];

        try {
            const dirs = await fs.readdir(basePath, { withFileTypes: true });
            Logger.info(`[KiroReader] Found ${dirs.length} workspace dirs`);

            for (const dir of dirs) {
                if (!dir.isDirectory()) continue;

                const sessionsFile = path.join(basePath, dir.name, 'sessions.json');
                try {
                    const content = await fs.readFile(sessionsFile, 'utf8');
                    const sessions: KiroSessionIndex[] = JSON.parse(content);
                    const visibleSessions = sessions.filter(s => !s.hidden);
                    if (visibleSessions.length === 0) continue;

                    const wsDir = visibleSessions[0].workspaceDirectory;
                    if (!wsDir) continue;

                    const latestDate = Math.max(...visibleSessions.map(s => Number(s.dateCreated) || 0));

                    workspaces.push({
                        id: `kiro:${dir.name}`,
                        name: path.basename(wsDir),
                        path: wsDir,
                        dbPath: path.join(basePath, dir.name),
                        lastModified: latestDate,
                        chatCount: visibleSessions.length,
                        source: 'Kiro'
                    });
                } catch {
                    continue;
                }
            }
        } catch (error) {
            Logger.error('[KiroReader] Failed to get workspaces', error);
        }

        Logger.info(`[KiroReader] Returning ${workspaces.length} workspaces: ${workspaces.map(w => w.path).join(', ')}`);
        return workspaces.sort((a, b) => b.lastModified - a.lastModified);
    }

    async getSessions(workspacePath: string): Promise<ChatSession[]> {
        const sessionsFile = path.join(workspacePath, 'sessions.json');
        const sessions: ChatSession[] = [];

        // Load full responses from q-chat-api-log files
        const responseMap = await this.loadResponsesFromLogs();

        try {
            const content = await fs.readFile(sessionsFile, 'utf8');
            const index: KiroSessionIndex[] = JSON.parse(content);

            for (const entry of index) {
                if (entry.hidden) continue;

                const sessionFile = path.join(workspacePath, `${entry.sessionId}.json`);
                try {
                    const raw = await fs.readFile(sessionFile, 'utf8');
                    const data: KiroSessionData = JSON.parse(raw);
                    const fullResponses = responseMap.get(entry.sessionId) || [];
                    const messages = this.parseMessages(data, fullResponses);

                    if (messages.length === 0) continue;

                    const timestamp = Number(entry.dateCreated) || Date.now();

                    sessions.push({
                        id: entry.sessionId,
                        title: entry.title || 'Kiro Session',
                        description: `${messages.length} messages`,
                        timestamp,
                        lastUpdatedAt: (await fs.stat(sessionFile)).mtimeMs,
                        messages,
                        source: 'Kiro'
                    });
                } catch {
                    continue;
                }
            }
        } catch (error) {
            Logger.error('[KiroReader] Failed to get sessions', error);
        }

        return sessions.sort((a, b) => b.timestamp - a.timestamp);
    }

    private parseMessages(data: KiroSessionData, fullResponses: string[]): ChatMessage[] {
        const messages: ChatMessage[] = [];
        let responseIdx = 0;

        for (const item of data.history || []) {
            const msg = item.message;
            if (!msg) continue;

            const role = msg.role as 'user' | 'assistant';
            if (role !== 'user' && role !== 'assistant') continue;

            let text: string;
            if (role === 'assistant' && responseIdx < fullResponses.length) {
                text = fullResponses[responseIdx];
                responseIdx++;
            } else {
                text = this.extractContent(msg.content);
            }

            if (!text.trim()) continue;
            messages.push({ role, content: text.trim() });
        }

        return messages;
    }

    private extractContent(content: any): string {
        if (typeof content === 'string') return content;
        if (!Array.isArray(content)) return '';

        return content
            .filter((part: any) => part.type === 'text' || part.type === 'mention')
            .map((part: any) => part.text || '')
            .join('\n');
    }

    /**
     * Scan q-chat-api-log.log files for full assistant responses.
     * Returns map: conversationId -> ordered list of full responses.
     */
    private async loadResponsesFromLogs(): Promise<Map<string, string[]>> {
        const result = new Map<string, string[]>();
        const logsDir = path.join(this.getKiroBasePath(), 'logs');

        try {
            const logFiles = await this.findChatApiLogs(logsDir);
            for (const logFile of logFiles) {
                await this.parseApiLog(logFile, result);
            }
        } catch {
            Logger.debug('[KiroReader] No log files found');
        }

        return result;
    }

    private async findChatApiLogs(logsDir: string): Promise<string[]> {
        const results: string[] = [];
        try {
            const sessionDirs = await fs.readdir(logsDir, { withFileTypes: true });
            for (const sd of sessionDirs) {
                if (!sd.isDirectory()) continue;
                const sdPath = path.join(logsDir, sd.name);
                try {
                    const windowDirs = (await fs.readdir(sdPath, { withFileTypes: true }))
                        .filter(d => d.isDirectory() && d.name.startsWith('window'));
                    for (const wd of windowDirs) {
                        const exthostDir = path.join(sdPath, wd.name, 'exthost');
                        try {
                            const outputDirs = (await fs.readdir(exthostDir, { withFileTypes: true }))
                                .filter(d => d.isDirectory() && d.name.startsWith('output_logging_'));
                            for (const od of outputDirs) {
                                const files = await fs.readdir(path.join(exthostDir, od.name));
                                for (const f of files) {
                                    if (f.endsWith('q-chat-api-log.log')) {
                                        results.push(path.join(exthostDir, od.name, f));
                                    }
                                }
                            }
                        } catch { /* skip */ }
                    }
                } catch { /* skip */ }
            }
        } catch { /* skip */ }
        return results;
    }

    /**
     * Parse a q-chat-api-log.log file.
     * Pattern: requests carry conversationId, responses follow in pairs
     * (intent classifier + real reply). We skip classifier responses.
     */
    private async parseApiLog(logFile: string, result: Map<string, string[]>): Promise<void> {
        try {
            const content = await fs.readFile(logFile, 'utf8');
            const lines = content.split('\n');
            let lastConvId = '';

            for (const line of lines) {
                if (!line.includes('{')) continue;
                try {
                    const idx = line.indexOf('{');
                    const data = JSON.parse(line.slice(idx));

                    if (data.request?.conversationState?.conversationId) {
                        lastConvId = data.request.conversationState.conversationId;
                    }

                    if (data.response && lastConvId) {
                        const fullResponse: string = data.response.fullResponse || '';
                        if (!fullResponse) continue;

                        // Skip intent classifier responses
                        const trimmed = fullResponse.trim();
                        const cleaned = trimmed.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
                        if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
                            try {
                                const obj = JSON.parse(cleaned);
                                if ('chat' in obj && 'do' in obj && 'spec' in obj) continue;
                            } catch { /* not classifier */ }
                        }

                        if (!result.has(lastConvId)) {
                            result.set(lastConvId, []);
                        }
                        result.get(lastConvId)!.push(fullResponse);
                    }
                } catch { /* skip malformed lines */ }
            }
        } catch { /* skip unreadable files */ }
    }
}

interface KiroSessionIndex {
    sessionId: string;
    title: string;
    dateCreated: string;
    workspaceDirectory: string;
    hidden?: boolean;
}

interface KiroSessionData {
    history: Array<{
        message: {
            role: string;
            content: any;
            id?: string;
        };
    }>;
}
