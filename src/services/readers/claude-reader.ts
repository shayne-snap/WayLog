
import * as fs from 'fs/promises';
import * as path from 'path';

import { ChatHistoryReader, WorkspaceInfo, ChatSession } from './types';
import { PlatformPaths } from '../../utils/platform-paths';
import { ClaudeParser, ClaudeEvent } from './claude-parser';
import { Logger } from '../../utils/logger';

export class ClaudeReader implements ChatHistoryReader {
    readonly name = 'Claude';
    readonly description = 'Chat history from Claude CLI and VS Code extension';
    readonly extensionId = 'anthropic.claude-code';

    async isAvailable(): Promise<boolean> {
        const claudePath = PlatformPaths.getClaudeProjectsPath();
        try {
            const stats = await fs.stat(claudePath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        const projectsPath = PlatformPaths.getClaudeProjectsPath();
        Logger.info(`[Claude] Projects path: ${projectsPath}`);

        if (!await this.exists(projectsPath)) {
            Logger.info('[Claude] Projects path does not exist');
            return [];
        }

        const entries = await fs.readdir(projectsPath, { withFileTypes: true });
        Logger.info(`[Claude] Found ${entries.length} entries in projects directory`);

        const workspaces: WorkspaceInfo[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const projectDir = path.join(projectsPath, entry.name);
            const sessions = await this.listSessionsInDir(projectDir);

            Logger.info(`[Claude] Project ${entry.name}: ${sessions.length} .jsonl files`);

            if (sessions.length === 0) continue;

            // Find the most recent session to extract metadata
            // Sort by descending modification time (newest first)
            sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);

            let cwd: string | null = null;
            const lastModified = sessions[0].mtimeMs;

            // Iterate through sessions until we find one with a valid CWD
            // This handles cases where the latest session file is empty (0 bytes) or corrupted
            for (const session of sessions) {
                const sessionPath = path.join(projectDir, session.file);
                cwd = await this.extractCwdFromSession(sessionPath);
                if (cwd) {
                    // Found a valid CWD, stop searching
                    // We still use the mtime from the absolute latest file for 'lastModified'
                    break;
                }
            }

            Logger.info(`[Claude] Extracted CWD for ${entry.name}: ${cwd || '(null - using fallback)'}`);

            if (cwd) {
                workspaces.push({
                    id: entry.name, // Use the encoded folder name as ID
                    name: path.basename(cwd),
                    path: cwd,
                    dbPath: projectDir, // Store the pointer to Claude's storage for this project
                    lastModified: lastModified,
                    chatCount: sessions.length,
                    source: 'Claude'
                });
            } else {
                // Fallback if we can't determine real path
                workspaces.push({
                    id: entry.name,
                    name: entry.name, // Display encoded name
                    path: entry.name, // No real path known
                    dbPath: projectDir,
                    lastModified: lastModified,
                    chatCount: sessions.length,
                    source: 'Claude'
                });
            }
        }

        Logger.info(`[Claude] Returning ${workspaces.length} workspaces`);
        return workspaces;
    }

    async getSessions(workspacePath: string): Promise<ChatSession[]> {
        Logger.debug(`[Claude] getSessions called with: ${workspacePath}`);

        const projectsPath = PlatformPaths.getClaudeProjectsPath();
        let sessionDir = '';

        // Case 1: workspacePath is already the full path to a project directory
        // (This happens because getWorkspaces sets dbPath to the projectDir)
        if (await this.exists(workspacePath) && workspacePath.startsWith(projectsPath)) {
            Logger.debug(`[Claude] Using path directly (appears to be resolved project dir): ${workspacePath}`);
            sessionDir = workspacePath;
        }
        // Case 2: workspacePath is a source code folder path (needs encoding)
        else {
            const encoded = this.encodePath(workspacePath);
            const candidate = path.join(projectsPath, encoded);

            Logger.debug(`[Claude] Encoded workspace path '${workspacePath}' -> '${encoded}'`);

            if (await this.exists(candidate)) {
                Logger.debug(`[Claude] Found encoded project dir: ${candidate}`);
                sessionDir = candidate;
            }
            // Case 3: workspacePath might be the folder name (ID) directly?
            else {
                const directJoin = path.join(projectsPath, workspacePath);
                if (await this.exists(directJoin)) {
                    Logger.debug(`[Claude] Found via direct join (ID): ${directJoin}`);
                    sessionDir = directJoin;
                }
            }
        }

        if (!sessionDir || !await this.exists(sessionDir)) {
            Logger.info(`[Claude] Could not find session directory for: ${workspacePath}`);
            return [];
        }

        const sessionFiles = await this.listSessionsInDir(sessionDir);
        const results: ChatSession[] = [];

        for (const { file, mtimeMs, birthtimeMs } of sessionFiles) {
            if (!file.endsWith('.jsonl')) continue;

            const filePath = path.join(sessionDir, file);
            try {
                const content = await fs.readFile(filePath, 'utf-8');

                // Peek first to skip sidechains efficiently (optimization)
                const firstChunk = content.slice(0, 1000);
                if (ClaudeParser.isSidechain(firstChunk)) {
                    continue;
                }

                // Use birthtime (creation time) if available, otherwise fallback to modification time
                // This ensures stable timestamps for sessions without internal dates (like error logs)
                const defaultTimestamp = birthtimeMs > 0 ? birthtimeMs : mtimeMs;
                const session = ClaudeParser.parseSession(content, file, defaultTimestamp);
                if (session) {
                    results.push(session);
                }
            } catch (e) {
                console.error(`Failed to parse Claude session ${file}:`, e);
            }
        }

        // Sort by timestamp desc
        return results.sort((a, b) => b.timestamp - a.timestamp);
    }

    // --- Helpers ---

    private async exists(p: string): Promise<boolean> {
        try {
            await fs.access(p);
            return true;
        } catch {
            return false;
        }
    }

    private async listSessionsInDir(dir: string): Promise<{ file: string, mtimeMs: number, birthtimeMs: number }[]> {
        try {
            const files = await fs.readdir(dir);
            const results = [];
            for (const file of files) {
                if (file.endsWith('.jsonl')) {
                    const stats = await fs.stat(path.join(dir, file));
                    results.push({
                        file,
                        mtimeMs: stats.mtimeMs,
                        birthtimeMs: stats.birthtimeMs
                    });
                }
            }
            return results;
        } catch {
            return [];
        }
    }

    private async extractCwdFromSession(filePath: string): Promise<string | null> {
        try {
            // Read first 16KB which should contain the first event with CWD
            const handle = await fs.open(filePath, 'r');

            const buffer = Buffer.alloc(16 * 1024);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            await handle.close();

            const content = buffer.toString('utf-8', 0, bytesRead);
            const lines = content.split(/\r?\n/);

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line) as ClaudeEvent;
                    if (event.cwd) return event.cwd;
                } catch { } // ignore invalid lines
            }
        } catch (e) {
            // ignore
        }
        return null;
    }

    /**
     * Encode path to match Claude's storage convention.
     * Matches Rust implementation: replace backslash with slash, then replace slash and colon with hyphen.
     */
    private encodePath(p: string): string {
        // 1. Normalize separators to /
        const normalized = p.split(path.sep).join('/');

        // 2. Replace / and : with -
        // Using replaceAll or regex global replace
        return normalized.replace(/[/:]/g, '-');
    }
}
