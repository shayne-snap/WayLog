import * as vscode from 'vscode';
import { ChatHistoryReader } from './types';
import { CodeBuddyReader } from './codebuddy-reader';
import { LingmaReader } from './lingma-reader';
import { CursorReader } from './cursor-reader';
import { CopilotChatReader } from './copilot-chat-reader';
import { ClineReader } from './cline-reader';
import { RooCodeReader } from './roo-code-reader';
import { KiloCodeReader } from './kilo-code-reader';
import { ClaudeReader } from './claude-reader';
import { CodexReader } from './codex-reader';
import { KiroReader } from './kiro-reader';
import { Logger } from '../../utils/logger';

export class SyncManager {
    private static instance: SyncManager;
    private readers: ChatHistoryReader[];

    private constructor() {
        this.readers = [
            new ClaudeReader(),
            new CursorReader(),
            new CopilotChatReader(),
            new ClineReader(),
            new RooCodeReader(),
            new KiloCodeReader(),
            new LingmaReader(),
            new CodeBuddyReader(),
            new CodexReader(),
            new KiroReader()
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
                const available = await Promise.race([
                    reader.isAvailable(),
                    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))
                ]);
                if (available) return reader;
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

        Logger.debug(`[SyncManager] Checking active providers from ${available.length} available candidates`);

        for (const reader of available) {
            let isActive = false;
            let reason = '';

            // 1. Check Native IDE match (e.g. Cursor)
            if (reader.name === 'Cursor' && appName.includes('Cursor')) {
                isActive = true;
                reason = 'Native IDE match';
            }
            // 2. Claude/Kiro - Always active if data exists
            else if (reader.name === 'Claude' || reader.name === 'Kiro') {
                isActive = true;
                reason = 'Data found (standalone tool)';
            }
            // 3. Check Installed Extension
            else if (reader.extensionId) {
                // Check if the extension is installed in the current VS Code / Cursor instance
                const extension = vscode.extensions.getExtension(reader.extensionId);
                if (extension) {
                    isActive = true;
                    reason = `Extension ${reader.extensionId} installed`;
                } else {
                    reason = `Extension ${reader.extensionId} NOT found`;
                }
            }

            if (isActive) {
                Logger.debug(`[SyncManager] ${reader.name} is ACTIVE (${reason})`);
                active.push(reader);
            } else {
                Logger.debug(`[SyncManager] ${reader.name} is INACTIVE (${reason})`);
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
