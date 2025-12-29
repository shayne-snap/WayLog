import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/logger';
import { SyncManager } from './readers/sync-manager';
import { ChatSession } from './readers/types';
import { findExistingFile, getFileMessageCount, generateFilename } from './waylog-index';
import { loadSessionContent, formatSessionMarkdown, formatMessages } from './session-utils';

export class AutoSaveService {
    private static instance: AutoSaveService | null = null;
    private syncInterval: NodeJS.Timeout | null = null;
    private readonly SYNC_INTERVAL_MS = 60 * 1000; // 1 minute

    private context?: vscode.ExtensionContext;

    private constructor() { }

    static getInstance(context?: vscode.ExtensionContext): AutoSaveService {
        if (!AutoSaveService.instance) {
            AutoSaveService.instance = new AutoSaveService();
        }
        if (context) {
            AutoSaveService.instance.context = context;
        }
        return AutoSaveService.instance;
    }

    /**
     * Start auto-save service
     */
    start() {
        if (this.syncInterval) {
            Logger.info('[AutoSave] Already running');
            return;
        }

        Logger.debug('[AutoSave] Starting auto-save service (1 minute interval)');

        // Run immediately once
        this.syncAllExportedSessions();

        // Then run every minute
        this.syncInterval = setInterval(() => {
            this.syncAllExportedSessions();
        }, this.SYNC_INTERVAL_MS);
    }

    /**
     * Stop auto-save service
     */
    stop() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            Logger.info('[AutoSave] Stopped auto-save service');
        }
    }

    /**
     * Sync all exported sessions
     */
    private async syncAllExportedSessions() {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || vscode.workspace.rootPath;
            if (!workspaceRoot) {
                Logger.info('[AutoSave] No workspace open, skipping sync');
                return;
            }

            const historyDir = path.join(workspaceRoot, '.waylog', 'history');

            // Create history directory if it doesn't exist
            try {
                await fs.mkdir(historyDir, { recursive: true });
            } catch (error) {
                Logger.error('[AutoSave] Failed to create .waylog/history directory', error);
                return;
            }

            Logger.debug(`[AutoSave] Running sync check...`);

            // Get all sessions from active readers only (Active-Only Policy)
            const manager = SyncManager.getInstance();
            const readers = await manager.getActiveProviders();

            let updatedCount = 0;
            let createdCount = 0;

            for (const reader of readers) {
                try {
                    const workspaces = await reader.getWorkspaces();

                    // Only sync sessions from the current workspace
                    // Normalize paths for accurate comparison
                    const normalizedRoot = path.normalize(workspaceRoot).toLowerCase();
                    const workspaceFile = vscode.workspace.workspaceFile;

                    let currentWorkspace = workspaces.find(ws => {
                        const normalizedWsPath = path.normalize(ws.path).toLowerCase();

                        // 1. Priority: Check if it matches the current .code-workspace file
                        if (workspaceFile && workspaceFile.scheme === 'file') {
                            const normalizedWorkspaceFile = path.normalize(workspaceFile.fsPath).toLowerCase();
                            if (normalizedWsPath === normalizedWorkspaceFile) {
                                return true;
                            }
                        }

                        // 2. Fallback: Exact match folder path
                        return normalizedWsPath === normalizedRoot;
                    });

                    // 3. Fuzzy Fallback: Match by folder name (basename)
                    // Solves drive letter or path format mismatch issues on Windows (e.g. C: vs c:)
                    if (!currentWorkspace) {
                        const currentBasename = path.basename(normalizedRoot);
                        const candidates = workspaces.filter(ws => {
                            const wsBasename = path.basename(path.normalize(ws.path).toLowerCase());
                            return wsBasename === currentBasename;
                        });

                        if (candidates.length > 0) {
                            // Pick the most recently modified one if multiple match
                            currentWorkspace = candidates.sort((a, b) => b.lastModified - a.lastModified)[0];
                            // Found by fuzzy match
                            Logger.info(`[AutoSave] Fuzzy matched workspace by name '${currentBasename}': ${currentWorkspace.path}`);
                        }
                    }


                    if (!currentWorkspace) {
                        Logger.debug(`[AutoSave] No ${reader.name} workspace found for ${workspaceRoot}`);
                        if (reader.name.includes('Roo') || reader.name.includes('Cline') || reader.name.includes('Kilo')) {
                            Logger.debug(`[AutoSave] Available workspaces: ${workspaces.map(w => w.path).join(', ')}`);
                        }
                        continue;
                    }


                    // Use dbPath for querying sessions (falls back to path if dbPath not available)
                    const dbPath = currentWorkspace.dbPath || currentWorkspace.path;
                    Logger.debug(`[AutoSave] Calling getSessions for ${reader.name} with dbPath: ${dbPath}`);
                    const sessions = await reader.getSessions(dbPath);
                    Logger.info(`[AutoSave] Got ${sessions.length} sessions from ${reader.name}`);

                    for (const session of sessions) {
                        // Optimization removed: We should always check file system state
                        // regardless of cached timestamp to handle cases where users delete files manually.
                        // The syncSession method already handles file existence checks efficiently.

                        const result = await this.syncSession(session, historyDir, dbPath);

                        if (result === 'updated') {
                            updatedCount++;
                        } else if (result === 'created') {
                            createdCount++;
                        }

                        // Update sync state on success
                        if ((result === 'updated' || result === 'created' || result === 'skipped') && this.context && session.lastUpdatedAt) {
                            // Even if skipped (e.g. file exists but content same), we can mark as synced to avoid re-reading file
                            // But 'skipped' in syncSession means "no new messages found in file check".
                            // So it is safe to update cache.
                            await this.context.workspaceState.update(`waylog.sync.${session.id}`, session.lastUpdatedAt);
                        }
                    }
                } catch (error) {
                    Logger.error(`[AutoSave] Error syncing ${reader.name}`, error);
                }
            }

            if (updatedCount > 0 || createdCount > 0) {
                if (createdCount > 0 || updatedCount > 0) {
                    Logger.info(`[AutoSave] Sync completed: ${createdCount} created, ${updatedCount} updated`);
                } else {
                    Logger.debug(`[AutoSave] Sync completed: 0 created, 0 updated`);
                }
            }
        } catch (error) {
            Logger.error('[AutoSave] Error in auto-sync', error);
        }
    }

    /**
     * Sync a single session
     */
    private async syncSession(session: ChatSession, historyDir: string, workspaceDbPath: string): Promise<'created' | 'updated' | 'skipped'> {
        try {
            Logger.debug(`[AutoSave] syncSession called for ${session.id} (${session.title})`);

            // For lazy-loaded sessions, fetch content first to get the real title
            // This is necessary because findExistingFile uses the title to generate filename
            if (session.messages.length === 0) {
                Logger.debug(`[AutoSave] Session has no messages, lazy loading...`);
                const manager = SyncManager.getInstance();
                const reader = manager.getReader(session.source) as any;
                Logger.debug(`[AutoSave] Got reader: ${reader ? reader.name : 'null'}`);

                if (reader) {
                    await loadSessionContent(session, reader, workspaceDbPath);
                    Logger.debug(`[AutoSave] Fetched ${session.messages.length} messages`);

                    // Previously we overrode the title here. 
                    // Now we trust the reader's title to match UI and avoid duplicate files.
                }
            }

            if (session.messages.length === 0) {
                Logger.debug(`[AutoSave] No messages after fetch, skipping`);
                return 'skipped';
            }

            Logger.debug(`[AutoSave] Checking for existing file...`);
            const existingFile = await findExistingFile(session, historyDir);
            Logger.debug(`[AutoSave] Existing file: ${existingFile || 'null'}`);

            if (!existingFile) {
                // File doesn't exist - create new file
                Logger.debug(`[AutoSave] Creating new file...`);
                const filename = generateFilename(session);
                Logger.debug(`[AutoSave] Generated filename: ${filename}`);
                const filepath = path.join(historyDir, filename);
                const content = formatSessionMarkdown(session);
                Logger.debug(`[AutoSave] Writing file to: ${filepath}`);
                await fs.mkdir(historyDir, { recursive: true });
                await fs.writeFile(filepath, content, 'utf8');

                Logger.debug(`[AutoSave] Created new file: ${filename}`);
                return 'created';
            }

            // File exists - check if there are new messages
            Logger.debug(`[AutoSave] File exists, checking message count...`);
            const fileMessageCount = await getFileMessageCount(existingFile);
            Logger.debug(`[AutoSave] File has ${fileMessageCount} messages, session has ${session.messages.length} messages`);

            // Lazy load messages if needed
            if (session.messages.length === 0) {
                const manager = SyncManager.getInstance();
                const reader = manager.getReader(session.source) as any;

                if (reader && reader.fetchSessionContent) {
                    session.messages = await reader.fetchSessionContent(session.id, workspaceDbPath);
                }
            }

            if (session.messages.length > fileMessageCount) {
                // Has new messages - append incrementally
                Logger.info(`[AutoSave] Updating ${path.basename(existingFile)}: ${fileMessageCount} → ${session.messages.length} messages`);

                const newMessages = session.messages.slice(fileMessageCount);
                const newContent = formatMessages(newMessages, session.source);

                await fs.appendFile(existingFile, '\n' + newContent, 'utf8');
                return 'updated';
            }

            return 'skipped';
        } catch (error) {
            Logger.error(`[AutoSave] Error syncing session ${session.id}`, error);
            Logger.error(`[AutoSave] Error details:`, error instanceof Error ? error.stack : error);
            return 'skipped';
        }
    }


}
