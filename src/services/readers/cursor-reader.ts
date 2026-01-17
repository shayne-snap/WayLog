import * as path from 'path';

import * as fs from 'fs/promises';
import { BaseVscdbReader } from './base-vscdb-reader';
import { ChatSession, ChatMessage, WorkspaceInfo } from './types';
import { Logger } from '../../utils/logger';
import { PlatformPaths } from '../../utils/platform-paths';
import { SqliteDatabase } from '../../utils/sqlite-database';
import { CursorParser } from './cursor-parser';

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


    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        if (!SqliteDatabase.isAvailable()) {
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
            Logger.error('[CursorReader] Workspace scan failed', error);
        }

        Logger.debug(`[CursorReader] Total workspaces found: ${workspaces.length}`);
        return workspaces.sort((a, b) => b.lastModified - a.lastModified);
    }

    private async countActualSessions(dbPath: string): Promise<number> {
        try {
            return await SqliteDatabase.using(dbPath, async (db) => {
                let count = 0;

                const legacyRow = await db.get('SELECT value FROM ItemTable WHERE [key] = ?', [this.chatDataKey]);
                if (legacyRow?.value) {
                    try {
                        const data = JSON.parse(legacyRow.value);
                        if (data.tabs) {
                            count += data.tabs.filter((t: any) => t.bubbles && t.bubbles.length > 0).length;
                        }
                    } catch { }
                }

                const compRow = await db.get('SELECT value FROM ItemTable WHERE [key] = ?', [this.composerDataKey]);
                if (compRow?.value) {
                    try {
                        const data = JSON.parse(compRow.value);
                        const composers = data.allComposers || [];
                        count += composers.filter((c: any) => CursorParser.isValidComposer(c)).length;
                    } catch (e) {
                        Logger.error('[CursorReader] Failed to parse composer data', e);
                    }
                }
                return count;
            });
        } catch (e) {
            return 0;
        }
    }

    protected async countChatSessions(dbPath: string): Promise<number> {
        return this.countActualSessions(dbPath);
    }

    async getSessions(dbPath: string): Promise<ChatSession[]> {
        const startTotal = Date.now();
        Logger.debug(`[CursorReader] getSessions METADATA-ONLY (no Global DB) started for ${dbPath}`);

        try {
            return await SqliteDatabase.using(dbPath, async (db) => {
                const sessions: ChatSession[] = [];

                // 1. Legacy Chat (stored locally, can get full content)
                const legacyRow = await db.get('SELECT value FROM ItemTable WHERE [key] = ?', [this.chatDataKey]);
                if (legacyRow?.value) {
                    const data = JSON.parse(legacyRow.value);
                    for (const tab of (data.tabs || [])) {
                        const messages = CursorParser.parseLegacyTabMessages(tab);
                        if (messages.length > 0) {
                            sessions.push({
                                id: tab.id || tab.tabId || Math.random().toString(),
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
                const compRow = await db.get('SELECT value FROM ItemTable WHERE [key] = ?', [this.composerDataKey]);
                if (compRow?.value) {
                    try {
                        const data = JSON.parse(compRow.value);
                        const composers = data.allComposers || [];
                        const composerSessions = CursorParser.parseComposers(composers, this.name);
                        sessions.push(...composerSessions);
                        Logger.debug(`[CursorReader] Identified ${composerSessions.length} composer sessions`);
                    } catch (e) {
                        Logger.error('[CursorReader] Failed to parse composer data', e);
                    }
                }

                Logger.debug(`[CursorReader] Total getSessions (metadata-only) took ${Date.now() - startTotal}ms`);
                return sessions.sort((a, b) => b.timestamp - a.timestamp);
            });
        } catch (error) {
            Logger.error('[CursorReader] Session fetch failed', error);
            return [];
        }
    }

    /**
     * Fetch full message content for a specific Composer session (lazy loading)
     * This is called during export, not during list loading
     */
    async fetchSessionContent(sessionId: string, workspaceDbPath: string): Promise<ChatMessage[]> {
        const startTime = Date.now();
        Logger.debug(`[CursorReader] Fetching content for session ${sessionId}`);

        try {
            // Use SqliteDatabase.using for workspace DB
            return await SqliteDatabase.using(workspaceDbPath, async (wsDb) => {
                // 1. Get composer metadata from workspace DB
                const compRow = await wsDb.get('SELECT value FROM ItemTable WHERE [key] = ?', [this.composerDataKey]);

                if (!compRow?.value) {
                    Logger.info('[CursorReader] No composer data found in workspace DB');
                    return [];
                }

                const data = JSON.parse(compRow.value);
                const composer = (data.allComposers || []).find((c: any) => c.composerId === sessionId);

                if (!composer) {
                    Logger.info(`[CursorReader] Composer ${sessionId} not found in metadata`);
                    return [];
                }

                // 2. Query Global DB for bubbles
                return await SqliteDatabase.using(this.globalDbPath, async (globalDb) => {
                    const bubbles: any[] = [];

                    await globalDb.each(
                        'SELECT value FROM cursorDiskKV WHERE key LIKE ?',
                        [`bubbleId:${sessionId}:%`],
                        (row: any) => {
                            try {
                                const bubble = JSON.parse(row.value);
                                if (bubble) bubbles.push(bubble);
                            } catch (e) {
                                Logger.error('[CursorReader] Failed to parse bubble', e);
                            }
                        }
                    );

                    // 3. Convert to ChatMessage format using CursorParser
                    const messages = CursorParser.parseBubbles(bubbles);

                    Logger.debug(`[CursorReader] Fetched ${messages.length} messages for session ${sessionId} in ${Date.now() - startTime}ms`);
                    return messages;

                    Logger.debug(`[CursorReader] Fetched ${messages.length} messages for session ${sessionId} in ${Date.now() - startTime}ms`);
                    return messages;
                });
            });
        } catch (error) {
            Logger.error(`[CursorReader] Failed to fetch session content for ${sessionId}`, error);
            return [];
        }
    }
}
