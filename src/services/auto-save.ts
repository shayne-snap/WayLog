import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/logger';
import { WorkspaceMatcher } from '../utils/workspace-matcher';
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
        if (!this.shouldRunSync()) return;

        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || vscode.workspace.rootPath;
            if (!workspaceRoot) {
                Logger.info('[AutoSave] No workspace open, skipping sync');
                return;
            }

            const historyDir = await this.prepareHistoryDirectory(workspaceRoot);
            if (!historyDir) return;

            Logger.debug('[AutoSave] Running sync check...');

            const manager = SyncManager.getInstance();
            const readers = await manager.getActiveProviders();

            let totalUpdated = 0;
            let totalCreated = 0;

            for (const reader of readers) {
                const { updated, created } = await this.processProviderSessions(reader, workspaceRoot, historyDir);
                totalUpdated += updated;
                totalCreated += created;
            }

            if (totalUpdated > 0 || totalCreated > 0) {
                Logger.info(`[AutoSave] Sync completed: ${totalCreated} created, ${totalUpdated} updated`);
            }
        } catch (error) {
            Logger.error('[AutoSave] Error in auto-sync', error);
        }
    }

    /**
     * Helper to check if sync should run based on configuration
     */
    private shouldRunSync(): boolean {
        const config = vscode.workspace.getConfiguration('waylog');
        if (!config.get<boolean>('autoSave', true)) {
            Logger.debug('[AutoSave] Skipping sync because auto-save is disabled');
            return false;
        }
        return true;
    }

    /**
     * Helper to prepare the history directory
     */
    private async prepareHistoryDirectory(workspaceRoot: string): Promise<string | undefined> {
        const historyDir = path.join(workspaceRoot, '.waylog', 'history');
        try {
            await fs.mkdir(historyDir, { recursive: true });
            return historyDir;
        } catch (error) {
            Logger.error('[AutoSave] Failed to create .waylog/history directory', error);
            return undefined;
        }
    }

    /**
     * Process sessions for a specific provider
     */
    private async processProviderSessions(
        reader: any,
        workspaceRoot: string,
        historyDir: string
    ): Promise<{ updated: number; created: number }> {
        let updated = 0;
        let created = 0;

        try {
            const workspaces = await reader.getWorkspaces();
            const currentWorkspace = WorkspaceMatcher.findBestMatch(
                workspaces,
                workspaceRoot,
                vscode.workspace.workspaceFile?.fsPath
            );

            if (!currentWorkspace) {
                Logger.debug(`[AutoSave] No ${reader.name} workspace found for ${workspaceRoot}`);
                return { updated, created };
            }

            const dbPath = currentWorkspace.dbPath || currentWorkspace.path;
            const sessions = await reader.getSessions(dbPath);
            Logger.info(`[AutoSave] Got ${sessions.length} sessions from ${reader.name}`);

            for (const session of sessions) {
                const result = await this.syncSession(session, historyDir, dbPath);

                if (result === 'updated') updated++;
                else if (result === 'created') created++;

                // Update sync state cache
                if ((result === 'updated' || result === 'created' || result === 'skipped') && this.context && session.lastUpdatedAt) {
                    await this.context.workspaceState.update(`waylog.sync.${session.id}`, session.lastUpdatedAt);
                }
            }
        } catch (error) {
            Logger.error(`[AutoSave] Error syncing ${reader.name}`, error);
        }

        return { updated, created };
    }


    /**
     * Sync a single session
     */
    private async syncSession(session: ChatSession, historyDir: string, workspaceDbPath: string): Promise<'created' | 'updated' | 'skipped'> {
        try {
            Logger.debug(`[AutoSave] Syncing session: ${session.id} (${session.title})`);

            // 1. Ensure we have session content (Lazy Loading)
            await this.ensureSessionContent(session, workspaceDbPath);
            if (session.messages.length === 0) return 'skipped';

            // 2. Check for existing file
            const existingFile = await findExistingFile(session, historyDir);

            if (!existingFile) {
                return await this.createNewFile(session, historyDir);
            }

            // 3. Incrementally update if there are new messages
            return await this.appendNewMessages(session, existingFile);
        } catch (error) {
            Logger.error(`[AutoSave] Error syncing session ${session.id}`, error);
            return 'skipped';
        }
    }

    /**
     * Ensures session content is loaded. Handles lazy loading from providers.
     */
    private async ensureSessionContent(session: ChatSession, workspaceDbPath: string): Promise<void> {
        if (session.messages.length > 0) return;

        Logger.debug(`[AutoSave] Lazy loading content for ${session.id}`);
        const manager = SyncManager.getInstance();
        const reader = manager.getReader(session.source) as any;

        if (reader) {
            await loadSessionContent(session, reader, workspaceDbPath);
            // Fallback to fetchSessionContent if loadSessionContent didn't do it
            if (session.messages.length === 0 && reader.fetchSessionContent) {
                session.messages = await reader.fetchSessionContent(session.id, workspaceDbPath);
            }
        }
    }

    /**
     * Creates a new file for a session
     */
    private async createNewFile(session: ChatSession, historyDir: string): Promise<'created'> {
        const filename = generateFilename(session);
        const filepath = path.join(historyDir, filename);
        const content = formatSessionMarkdown(session);

        Logger.debug(`[AutoSave] Creating new file: ${filename}`);
        await fs.mkdir(historyDir, { recursive: true });
        await fs.writeFile(filepath, content, 'utf8');

        return 'created';
    }

    /**
     * Appends new messages to an existing file if available
     */
    private async appendNewMessages(session: ChatSession, existingFile: string): Promise<'updated' | 'skipped'> {
        const fileMessageCount = await getFileMessageCount(existingFile);

        if (session.messages.length > fileMessageCount) {
            Logger.info(`[AutoSave] Updating ${path.basename(existingFile)}: ${fileMessageCount} → ${session.messages.length} messages`);

            const newMessages = session.messages.slice(fileMessageCount);
            const newContent = formatMessages(newMessages, session.source);

            await fs.appendFile(existingFile, '\n' + newContent, 'utf8');
            return 'updated';
        }

        return 'skipped';
    }


}
