import * as vscode from 'vscode';
import { ChatHistoryReader } from './types';
import { CodeBuddyReader } from './codebuddy-reader';
import { LingmaReader } from './lingma-reader';
import { CursorReader } from './cursor-reader';
import { CopilotChatReader } from './copilot-chat-reader';
import { ClineReader } from './cline-reader';
import { RooCodeReader } from './roo-code-reader';
import { KiloCodeReader } from './kilo-code-reader';
import { CodexReader } from './codex-reader';
import { Logger } from '../../utils/logger';

export class SyncManager {
    private static instance: SyncManager;
    private readers: ChatHistoryReader[];

    private constructor() {
        this.readers = [
            new CursorReader(),
            new CopilotChatReader(),
            new ClineReader(),
            new RooCodeReader(),
            new KiloCodeReader(),
            new LingmaReader(),
            new CodeBuddyReader(),
            new CodexReader()
        ];
        Logger.debug(`[SyncManager] Initialized with ${this.readers.length} readers`);
    }

    public static getInstance(): SyncManager {
        if (!SyncManager.instance) {
            SyncManager.instance = new SyncManager();
        }
        return SyncManager.instance;
    }

    /**
     * Returns a list of all providers that are available (have data or are active).
     */
    public async getAvailableProviders(): Promise<ChatHistoryReader[]> {
        const checks = this.readers.map(async reader => {
            try {
                if (await reader.isAvailable()) {
                    return reader;
                }
            } catch (error) {
                Logger.error(`[SyncManager] Failed to check availability for ${reader.name}`, error);
            }
            return null;
        });

        const results = await Promise.all(checks);
        return results.filter((r): r is ChatHistoryReader => r !== null);
    }

    /**
     * Returns a list of active providers in the current IDE context.
     * Filtered by Native App Name or Extension Installation.
     * Used for auto-sync to ensure we only sync relevant tools.
     */
    public async getActiveProviders(): Promise<ChatHistoryReader[]> {
        // We get available providers first to ensure initialization checks passed
        const available = await this.getAvailableProviders();
        const active: ChatHistoryReader[] = [];
        const appName = vscode.env.appName || '';

        for (const reader of available) {
            let isActive = false;

            // 1. Check Native IDE match (e.g. Cursor)
            if (reader.name === 'Cursor' && appName.includes('Cursor')) {
                isActive = true;
            }
            // 2. Check Installed Extension
            else if (reader.extensionId) {
                // Check if the extension is installed in the current VS Code / Cursor instance
                if (vscode.extensions.getExtension(reader.extensionId)) {
                    isActive = true;
                }
            }

            if (isActive) {
                active.push(reader);
            }
        }
        return active;
    }

    public getReader(name: string): ChatHistoryReader | undefined {
        return this.readers.find(r => r.name === name);
    }

    public getAllReaders(): ChatHistoryReader[] {
        return this.readers;
    }
}
