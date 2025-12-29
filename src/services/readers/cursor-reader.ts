import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { BaseVscdbReader } from './base-vscdb-reader';
import { ChatSession, ChatMessage, WorkspaceInfo } from './types';
import { Logger } from '../../utils/logger';
import { PlatformPaths } from '../../utils/platform-paths';

// Try to load the module, handle failure gracefully
let sqlite3: any;
try {
    sqlite3 = require('@vscode/sqlite3');
} catch (e) {
    Logger.error('[CursorReader] Failed to require @vscode/sqlite3. Is it installed?', e);
    sqlite3 = null;
}

export class CursorReader extends BaseVscdbReader {
    public readonly name = 'Cursor';
    public readonly description = 'From Cursor IDE (Chat & Composer/Agent)';

    get storageBaseDir(): string {
        return PlatformPaths.getCursorStoragePath();
    }

    get globalDbPath(): string {
        return PlatformPaths.getCursorGlobalStoragePath();
    }

    get chatDataKey(): string {
        return 'workbench.panel.aichat.view.aichat.chatdata';
    }

    get composerDataKey(): string {
        return 'composer.composerData';
    }

    private async openNativeDb(dbPath: string): Promise<any> {
        if (!sqlite3) {
            throw new Error('SQLite native driver not available');
        }
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err: any) => {
                if (err) reject(err);
                else resolve(db);
            });
        });
    }

    private async dbGet(db: any, sql: string, params: any[] = []): Promise<any> {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err: any, row: any) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    private async dbClose(db: any): Promise<void> {
        return new Promise((resolve, reject) => {
            db.close((err: any) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        if (!sqlite3) {
            Logger.info('[CursorReader] Native SQLite not available. Cannot scan Cursor workspaces.');
            return [];
        }

        Logger.debug(`[CursorReader] Scanning workspaces in: ${this.storageBaseDir}`);

        const workspaces: WorkspaceInfo[] = [];

        try {
            const folders = await fs.readdir(this.storageBaseDir);
            Logger.debug(`[CursorReader] Found ${folders.length} folders in storage directory`);

            for (const folder of folders) {
                const workspacePath = path.join(this.storageBaseDir, folder);
                const dbPath = path.join(workspacePath, 'state.vscdb');

                try {
                    await fs.access(dbPath);
                    const stats = await fs.stat(dbPath);

                    const count = await this.countActualSessions(dbPath);
                    Logger.debug(`[CursorReader] Workspace ${folder}: ${count} sessions`);

                    if (count > 0) {
                        const details = await this.resolveWorkspaceDetails(workspacePath);

                        // Use base class resolution, fallback to DB path if needed
                        const projectPath = details.path || dbPath;
                        const workspaceName = details.name;

                        workspaces.push({
                            id: folder,
                            name: workspaceName || `Workspace ${folder.slice(0, 6)}`,
                            path: projectPath,  // Project folder path for matching
                            dbPath: dbPath,     // Database path for querying
                            lastModified: stats.mtimeMs,
                            chatCount: count,
                            source: this.name
                        });
                    }
                } catch (e) {
                    // Skip folders without state.vscdb
                    continue;
                }
            }
        } catch (error) {
            Logger.error(`[CursorReader] Workspace scan failed`, error);
        }

        Logger.debug(`[CursorReader] Total workspaces found: ${workspaces.length}`);
        return workspaces.sort((a, b) => b.lastModified - a.lastModified);
    }

    private async countActualSessions(dbPath: string): Promise<number> {
        let wsDb: any = null;

        try {
            wsDb = await this.openNativeDb(dbPath);
            let count = 0;

            const legacyRow = await this.dbGet(wsDb, "SELECT value FROM ItemTable WHERE [key] = ?", [this.chatDataKey]);
            if (legacyRow?.value) {
                try {
                    const data = JSON.parse(legacyRow.value);
                    if (data.tabs) {
                        count += data.tabs.filter((t: any) => t.bubbles && t.bubbles.length > 0).length;
                    }
                } catch { }
            }

            const compRow = await this.dbGet(wsDb, "SELECT value FROM ItemTable WHERE [key] = ?", [this.composerDataKey]);
            if (compRow?.value) {
                try {
                    const data = JSON.parse(compRow.value);
                    if (data.allComposers && Array.isArray(data.allComposers)) {
                        for (const comp of data.allComposers) {
                            if (!comp.composerId) continue;

                            if (comp.name && comp.name !== 'Untitled Composer') {
                                count++;
                                continue;
                            }

                            const hasSubtitle = !!comp.subtitle;
                            const hasCodeChanges = (comp.totalLinesAdded || 0) > 0 || (comp.totalLinesRemoved || 0) > 0;
                            const lastUpdate = comp.lastUpdatedAt || comp.createdAt || 0;
                            const isActive = lastUpdate - (comp.createdAt || 0) > 5000;

                            if (hasSubtitle || hasCodeChanges || isActive) {
                                count++;
                            }
                        }
                    }
                } catch (e) {
                    Logger.error(`[CursorReader] Failed to parse composer data`, e);
                }
            }
            return count;
        } catch (e) {
            return 0;
        } finally {
            if (wsDb) await this.dbClose(wsDb);
        }
    }

    protected async countChatSessions(dbPath: string): Promise<number> {
        return this.countActualSessions(dbPath);
    }

    async getSessions(dbPath: string): Promise<ChatSession[]> {
        const startTotal = Date.now();
        Logger.debug(`[CursorReader] getSessions METADATA-ONLY (no Global DB) started for ${dbPath}`);

        const sessions: ChatSession[] = [];
        let wsDb: any = null;

        try {
            wsDb = await this.openNativeDb(dbPath);

            // 1. Legacy Chat (stored locally, can get full content)
            const legacyRow = await this.dbGet(wsDb, "SELECT value FROM ItemTable WHERE [key] = ?", [this.chatDataKey]);
            if (legacyRow?.value) {
                const data = JSON.parse(legacyRow.value);
                for (const tab of (data.tabs || [])) {
                    const messages: ChatMessage[] = [];
                    for (const b of (tab.bubbles || [])) {
                        const text = b.text || b.modelResponse;
                        if (text) {
                            messages.push({
                                role: b.type === 'user' ? 'user' : 'assistant',
                                content: text,
                                timestamp: tab.lastUpdatedAt || Date.now(),
                                metadata: { model: b.modelType || 'unknown', type: 'legacy' }
                            });
                        }
                    }
                    if (messages.length > 0) {
                        sessions.push({
                            id: tab.tabId || Math.random().toString(),
                            title: tab.chatTitle || messages[0].content.slice(0, 50),
                            description: `Chat (${messages.length} msg)`,
                            timestamp: tab.lastUpdatedAt || Date.now(),
                            lastUpdatedAt: tab.lastUpdatedAt || Date.now(),
                            messages,
                            source: this.name
                        });
                    }
                }
            }

            // 2. Composer - METADATA ONLY (DO NOT OPEN GLOBAL DB)
            const compRow = await this.dbGet(wsDb, "SELECT value FROM ItemTable WHERE [key] = ?", [this.composerDataKey]);
            if (compRow?.value) {
                const data = JSON.parse(compRow.value);
                const composers = data.allComposers || [];
                Logger.debug(`[CursorReader] Found ${composers.length} raw composers`);

                // Filter valid composers based on local metadata
                for (const comp of composers) {
                    if (!comp.composerId) continue;

                    const hasCustomName = comp.name && comp.name !== 'Untitled Composer';
                    const hasSubtitle = !!comp.subtitle;
                    const hasCodeChanges = (comp.totalLinesAdded || 0) > 0 || (comp.totalLinesRemoved || 0) > 0;
                    const lastUpdate = comp.lastUpdatedAt || comp.createdAt || 0;
                    const isActive = lastUpdate - (comp.createdAt || 0) > 5000;

                    if (hasCustomName || hasSubtitle || hasCodeChanges || isActive) {
                        // Generate title from metadata
                        let title = comp.name || 'Untitled Composer';
                        if (title === 'Untitled Composer' && comp.subtitle) {
                            title = comp.subtitle.slice(0, 50);
                        }

                        sessions.push({
                            id: comp.composerId,
                            title,
                            description: `${comp.unifiedMode || 'Agent'} Mode`,
                            timestamp: comp.createdAt || comp.lastUpdatedAt || Date.now(),
                            lastUpdatedAt: comp.lastUpdatedAt || comp.createdAt || Date.now(),
                            messages: [], // EMPTY - will be populated during actual export
                            source: this.name
                        });

                        Logger.debug(`[CursorReader] Session ${comp.composerId.slice(0, 8)}: createdAt=${comp.createdAt}, lastUpdatedAt=${comp.lastUpdatedAt}, using=${comp.createdAt || comp.lastUpdatedAt || Date.now()}`);
                    }
                }

                Logger.debug(`[CursorReader] Identified ${sessions.length} sessions from metadata`);
            }

            Logger.debug(`[CursorReader] Total getSessions (metadata-only) took ${Date.now() - startTotal}ms`);
            return sessions.sort((a, b) => b.timestamp - a.timestamp);
        } catch (error) {
            Logger.error(`[CursorReader] Session fetch failed`, error);
            return [];
        } finally {
            if (wsDb) await this.dbClose(wsDb);
        }
    }

    /**
     * Fetch full message content for a specific Composer session (lazy loading)
     * This is called during export, not during list loading
     */
    async fetchSessionContent(sessionId: string, workspaceDbPath: string): Promise<ChatMessage[]> {
        const startTime = Date.now();
        Logger.debug(`[CursorReader] Fetching content for session ${sessionId}`);

        let globalDb: any = null;
        let wsDb: any = null;

        try {
            // 1. Get composer metadata from workspace DB
            wsDb = await this.openNativeDb(workspaceDbPath);
            const compRow = await this.dbGet(wsDb, "SELECT value FROM ItemTable WHERE [key] = ?", [this.composerDataKey]);

            if (!compRow?.value) {
                Logger.info(`[CursorReader] No composer data found in workspace DB`);
                return [];
            }

            const data = JSON.parse(compRow.value);
            const composer = (data.allComposers || []).find((c: any) => c.composerId === sessionId);

            if (!composer) {
                Logger.info(`[CursorReader] Composer ${sessionId} not found in metadata`);
                return [];
            }

            // 2. Query Global DB for bubbles
            globalDb = await this.openNativeDb(this.globalDbPath);
            const bubbles: any[] = [];

            await new Promise<void>((resolve, reject) => {
                globalDb.each(
                    `SELECT value FROM cursorDiskKV WHERE key LIKE ?`,
                    [`bubbleId:${sessionId}:%`],
                    (err: any, row: any) => {
                        if (err) {
                            Logger.error(`[CursorReader] Error reading bubble`, err);
                            return;
                        }
                        try {
                            const bubble = JSON.parse(row.value);
                            if (bubble) bubbles.push(bubble);
                        } catch (e) {
                            Logger.error(`[CursorReader] Failed to parse bubble`, e);
                        }
                    },
                    (err: any) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // 3. Sort by creation time
            bubbles.sort((a, b) =>
                (new Date(a.createdAt || 0).getTime()) - (new Date(b.createdAt || 0).getTime())
            );

            // 4. Convert to ChatMessage format (Cursor-style: merge consecutive assistant messages)
            const messages: ChatMessage[] = [];
            let currentAssistantMessage: { content: string; timestamp: number } | null = null;

            for (const b of bubbles) {
                // Extract text content
                let content = b.text || '';
                if (!content && b.richText) {
                    try {
                        const rt = JSON.parse(b.richText);
                        if (rt.root?.children) {
                            content = rt.root.children
                                .map((c: any) => c.children ? c.children.map((cc: any) => cc.text || '').join('') : '')
                                .join('\n').trim();
                        }
                    } catch { }
                }

                const role = b.type === 1 ? 'user' : 'assistant';

                // Skip bubbles with no content (pure tool calls or thinking)
                if (!content) {
                    continue;
                }

                if (role === 'user') {
                    // Flush any pending assistant message
                    if (currentAssistantMessage) {
                        messages.push({
                            role: 'assistant',
                            content: currentAssistantMessage.content.trim(),
                            timestamp: currentAssistantMessage.timestamp,
                            metadata: {}
                        });
                        currentAssistantMessage = null;
                    }

                    // Add user message
                    messages.push({
                        role: 'user',
                        content: content.trim(),
                        timestamp: b.createdAt ? new Date(b.createdAt).getTime() : Date.now(),
                        metadata: {}
                    });
                } else {
                    // Assistant message - merge with previous if exists
                    if (currentAssistantMessage) {
                        // Append to existing assistant message
                        currentAssistantMessage.content += '\n\n' + content;
                    } else {
                        // Start new assistant message
                        currentAssistantMessage = {
                            content: content,
                            timestamp: b.createdAt ? new Date(b.createdAt).getTime() : Date.now()
                        };
                    }
                }
            }

            // Flush any remaining assistant message
            if (currentAssistantMessage) {
                messages.push({
                    role: 'assistant',
                    content: currentAssistantMessage.content.trim(),
                    timestamp: currentAssistantMessage.timestamp,
                    metadata: {}
                });
            }

            Logger.debug(`[CursorReader] Fetched ${messages.length} messages for session ${sessionId} in ${Date.now() - startTime}ms`);
            return messages;
        } catch (error) {
            Logger.error(`[CursorReader] Failed to fetch session content for ${sessionId}`, error);
            return [];
        } finally {
            if (wsDb) await this.dbClose(wsDb);
            if (globalDb) await this.dbClose(globalDb);
        }
    }
}
