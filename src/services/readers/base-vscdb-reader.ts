import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ChatHistoryReader, WorkspaceInfo, ChatSession, ChatMessage } from './types';
import { Logger } from '../../utils/logger';



export abstract class BaseVscdbReader implements ChatHistoryReader {
    abstract name: string;
    abstract description: string;
    abstract get storageBaseDir(): string;
    abstract get chatDataKey(): string;

    async isAvailable(): Promise<boolean> {
        try {
            await fs.access(this.storageBaseDir);
            return true;
        } catch {
            return false;
        }
    }

    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        const workspaces: WorkspaceInfo[] = [];
        try {
            const hasFolders = await fs.readdir(this.storageBaseDir);
            for (const folder of hasFolders) {
                const workspacePath = path.join(this.storageBaseDir, folder);
                const dbPath = path.join(workspacePath, 'state.vscdb');

                try {
                    await fs.access(dbPath);
                    const stats = await fs.stat(dbPath);

                    // Try to resolve workspace name and path from workspace.json
                    const details = await this.resolveWorkspaceDetails(workspacePath);

                    // Check if there's actually chat data in this DB
                    const chatCount = await this.countChatSessions(dbPath);

                    if (chatCount > 0) {
                        workspaces.push({
                            id: folder,
                            name: details.name || `Workspace ${folder.slice(0, 6)}`,
                            path: details.path || dbPath, // Use actual project path if available
                            dbPath: dbPath, // Always keep the DB path specifically
                            lastModified: stats.mtimeMs,
                            chatCount: chatCount,
                            source: this.name
                        });
                    }
                } catch {
                    continue; // Skip folders without state.vscdb
                }
            }
        } catch (error) {
            Logger.error(`[${this.name}] Failed to scan workspaces`, error);
        }
        return workspaces.sort((a, b) => b.lastModified - a.lastModified);
    }

    abstract getSessions(dbPath: string): Promise<ChatSession[]>;

    protected async runSqliteQuery(dbPath: string, query: string): Promise<any[]> {
        try {
            const { execFile } = require('child_process');
            const { promisify } = require('util');
            const execFileAsync = promisify(execFile);

            // maxBuffer: 100MB (default is 1MB, which might be too small for large JSON outputs)
            // But for simple counts it's fine. For fetching all chat history, it might be large.
            // If the output is huge (2GB+), even CLI -json -> string -> JSON.parse will crash Node.js process (string length limits).
            // However, we are typically querying specific keys or rows. The single value for 'composer.composerData' might be large?
            // If composerData is 2GB, we are in trouble regardless. But usually the DB is 2GB because of many entries, not one single row being 2GB.

            const { stdout } = await execFileAsync('/usr/bin/sqlite3', ['-json', dbPath, query], { maxBuffer: 1024 * 1024 * 50 });
            if (!stdout || !stdout.trim()) return [];
            return JSON.parse(stdout);
        } catch (error: any) {
            // Ignore "Error: Command failed" if it's just empty result or similar expected sqlite issues
            if (error?.code !== 1) { // code 1 is general error
                Logger.info(`[BaseVscdbReader] SQLite query failed: ${error.message}`);
            }
            return [];
        }
    }

    protected async getTableValue(dbPath: string, tableName: string, key: string): Promise<string | null> {
        try {
            const safeKey = key.replace(/'/g, "''");
            const query = `SELECT value FROM ${tableName} WHERE [key] = '${safeKey}' LIMIT 1`;
            const results = await this.runSqliteQuery(dbPath, query);
            if (results && results.length > 0) {
                return results[0].value;
            }
            return null;
        } catch (e) {
            Logger.error(`[${this.name}] DB Query failed`, e);
            return null;
        }
    }

    protected async countChatSessions(dbPath: string): Promise<number> {
        try {
            const value = await this.getTableValue(dbPath, 'ItemTable', this.chatDataKey);
            if (!value) return 0;
            const data = JSON.parse(value);
            // Support both Cursor (tabs) and Native VS Code (entries)
            if (data.tabs) return data.tabs.length;
            if (data.entries) return Object.keys(data.entries).length;
            return 0;
        } catch {
            return 0;
        }
    }

    protected async resolveWorkspaceDetails(workspacePath: string): Promise<{ name: string | null, path: string | null }> {
        try {
            const workspaceJsonPath = path.join(workspacePath, 'workspace.json');
            const data = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf8'));

            let name: string | null = null;
            let projectPath: string | null = null;

            if (data.folder) {
                projectPath = decodeURIComponent(data.folder).replace('file://', '');
                name = path.basename(projectPath);
            } else if (data.workspace) {
                projectPath = decodeURIComponent(data.workspace).replace('file://', '');
                name = path.basename(projectPath).replace('.code-workspace', '');
            }

            // Debug logging for troubleshooting
            if (this.name === 'Copilot Chat' && projectPath && projectPath.includes('antigravity-vscode')) {
                Logger.debug(`[BaseVscdbReader] Resolved workspace details for ${workspacePath}:`);
                Logger.debug(`  - Raw folder: ${data.folder}`);
                Logger.debug(`  - Raw workspace: ${data.workspace}`);
                Logger.debug(`  - Resolved Path: ${projectPath}`);
            }

            return { name, path: projectPath };
        } catch { }
        return { name: null, path: null };
    }

}
