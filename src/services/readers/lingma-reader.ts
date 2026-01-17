import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { Logger } from '../../utils/logger';
import { ChatHistoryReader, WorkspaceInfo, ChatSession } from './types';

// Try to load the module, handle failure gracefully
let sqlite3: any;
try {
    sqlite3 = require('@vscode/sqlite3').verbose();
} catch (e) {
    Logger.error('[LingmaReader] Failed to require @vscode/sqlite3. Is it installed or platform compatible?', e);
    sqlite3 = null;
}

export class LingmaReader implements ChatHistoryReader {
    public readonly name = 'Alibaba Lingma';
    public readonly description = 'Summaries only';
    public readonly extensionId = 'alibaba-cloud.tongyi-lingma';

    public async isAvailable(): Promise<boolean> {
        if (!sqlite3) {
            Logger.debug('[LingmaReader] Native SQLite not available, skipping');
            return false;
        }

        const dbPath = await this.getLingmaDbPathAsync();
        Logger.debug(`[LingmaReader] Checking DB path: ${dbPath}`);
        if (!dbPath) return false;
        try {
            await fs.access(dbPath);
            Logger.debug('[LingmaReader] DB file exists');
            return true;
        } catch (e) {
            Logger.debug(`[LingmaReader] DB file access failed: ${e}`);
            return false;
        }
    }

    public async getWorkspaces(): Promise<WorkspaceInfo[]> {
        const dbPath = await this.getLingmaDbPathAsync();
        Logger.debug(`[LingmaReader] getWorkspaces checking DB path: ${dbPath}`);
        if (!dbPath) return [];

        try {
            await fs.access(dbPath);
            const stats = await fs.stat(dbPath);
            const count = await this.countChats(dbPath);

            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                return [];
            }

            // Since Lingma uses a global DB, return a WorkspaceInfo for each open VS Code workspace
            return vscode.workspace.workspaceFolders.map(folder => ({
                id: `lingma-${folder.uri.toString()}`, // simple ID
                name: `Lingma History (${folder.name})`,
                path: folder.uri.fsPath,
                dbPath: dbPath, // Pass the actual DB path here
                lastModified: stats.mtimeMs,
                chatCount: count,
                source: this.name
            }));
        } catch (error) {
            Logger.error(`[LingmaReader] getWorkspaces failed: ${error}`, error);
            return [];
        }
    }

    public async getSessions(_dbPath: string): Promise<ChatSession[]> {
        const realDbPath = await this.getLingmaDbPathAsync();
        if (!realDbPath) return [];

        try {
            // Query chat_record table
            // Group by session_id
            const query = `
                SELECT
                    session_id,
                    request_id,
                    chat_prompt,
                    summary,
                    error_result,
                    gmt_create,
                    extra
                FROM chat_record
                WHERE chat_prompt != ''
                ORDER BY gmt_create ASC
            `;
            // Note: Changed order to ASC to process messages in chronological order,
            // though we can also sort later.

            const rows = await this.queryAll(realDbPath, query);

            const sessionsMap = new Map<string, ChatSession>();

            for (const row of rows) {
                const sessionId = row.session_id;

                if (!sessionId) continue;

                let session = sessionsMap.get(sessionId);
                if (!session) {
                    session = {
                        id: sessionId,
                        title: (row.chat_prompt || 'New Chat').slice(0, 50), // Will be overwritten by first message if we want
                        description: 'Summary version (original answer is encrypted)',
                        timestamp: row.gmt_create, // Start time of session
                        messages: [],
                        source: this.name,
                        lastUpdatedAt: row.gmt_create
                    };
                    sessionsMap.set(sessionId, session);
                }

                const prompt = row.chat_prompt || 'Empty Query';
                let summary = row.summary;

                // If summary is empty, check for error
                if (!summary) {
                    if (row.error_result && row.error_result !== '{}') {
                        summary = `⚠️ Error: ${row.error_result}`;
                    } else {
                        summary = '[No summary available]';
                    }
                }

                // User Message
                session.messages.push({
                    role: 'user',
                    content: prompt,
                    timestamp: row.gmt_create
                });

                // Assistant Message (summary)
                session.messages.push({
                    role: 'assistant',
                    content: summary,
                    timestamp: row.gmt_create + 100
                });

                // Update last updated time
                if (row.gmt_create > (session.lastUpdatedAt || 0)) {
                    session.lastUpdatedAt = row.gmt_create;
                    // Also update timestamp if we want the file date to reflect the latest activity?
                    // Usually timestamp is creation date, lastUpdatedAt is modification.
                }
            }

            // Convert map to array and sort sessions by last update time (descending)
            const sessions = Array.from(sessionsMap.values());
            sessions.sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0));

            return sessions;
        } catch (error) {
            Logger.error('[LingmaReader] Failed to read sessions', error);
            return [];
        }
    }

    private getLingmaDbPaths(): string[] {
        const homeDir = os.homedir();
        // Check both VS Code Stable and Insiders
        return [
            path.join(homeDir, '.lingma', 'vscode', 'sharedClientCache', 'cache', 'db', 'local.db'),
            path.join(homeDir, '.lingma', 'vscode-insiders', 'sharedClientCache', 'cache', 'db', 'local.db')
        ];
    }

    private async getLingmaDbPathAsync(): Promise<string | null> {
        // Return first existing path
        for (const dbPath of this.getLingmaDbPaths()) {
            try {
                await fs.access(dbPath);
                return dbPath;
            } catch {
                continue;
            }
        }
        return null;
    }

    private async countChats(dbPath: string): Promise<number> {
        try {
            const rows = await this.queryAll(dbPath, 'SELECT COUNT(*) as count FROM chat_record WHERE chat_prompt IS NOT NULL');
            return rows[0]?.count || 0;
        } catch {
            return 0;
        }
    }

    /**
     * Helper to run SQL query using @vscode/sqlite3
     */
    private queryAll(dbPath: string, sql: string, params: any[] = []): Promise<any[]> {
        if (!sqlite3) {
            return Promise.reject(new Error('SQLite native driver not available'));
        }

        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err: Error | null) => {
                if (err) {
                    reject(err);
                    return;
                }
            });

            db.all(sql, params, (err: Error | null, rows: any[]) => {
                if (err) {
                    db.close();
                    reject(err);
                    return;
                }

                db.close((err: Error | null) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        });
    }
}
