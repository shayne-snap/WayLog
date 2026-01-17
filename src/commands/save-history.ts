import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/logger';
import { SyncManager } from '../services/readers/sync-manager';
import { ChatSession } from '../services/readers/types';
import { findExistingFile, getFileMessageCount, generateFilename } from '../services/waylog-index';
import { loadSessionContent, formatSessionMarkdown } from '../services/session-utils';

export async function saveHistoryCommand() {
    try {
        // 0. Pre-check: Must have a workspace open
        const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!currentWorkspace) {
            vscode.window.showErrorMessage('To use WayLog you need to open a workspace first.');
            return;
        }

        const manager = SyncManager.getInstance();

        // 1. Select Provider
        const providers = await manager.getAvailableProviders();
        if (providers.length === 0) {
            vscode.window.showWarningMessage('No supported AI IDEs found on this machine.');
            return;
        }

        let selectedProviderName: string;

        // Calculate how many providers are "active" in the current environment
        // A provider is "active" if:
        // 1. It's Cursor and we're running in Cursor IDE, OR
        // 2. It has an extensionId and that extension is installed
        const appName = vscode.env.appName || '';
        const activeProviders = providers.filter(p => {
            // Cursor is only active in Cursor IDE
            if (p.name === 'Cursor' && appName.includes('Cursor')) {
                return true;
            }
            // Other providers are active if their extension is installed
            if (p.extensionId && vscode.extensions.getExtension(p.extensionId)) {
                return true;
            }
            return false;
        });

        // Only skip the picker if there's exactly one active provider
        if (activeProviders.length === 1) {
            selectedProviderName = activeProviders[0].name;
        } else {
            // Group and sort providers
            const nativeGroup: any[] = [];
            const activeGroup: any[] = [];
            const otherGroup: any[] = [];

            for (const p of providers) {
                // Check native IDE (Cursor)
                if (p.name === 'Cursor' && appName.includes('Cursor')) {
                    nativeGroup.push(p);
                    continue;
                }

                // Check installed extension
                if (p.extensionId && vscode.extensions.getExtension(p.extensionId)) {
                    activeGroup.push(p);
                    continue;
                }

                otherGroup.push(p);
            }

            const items: (vscode.QuickPickItem & { provider?: any })[] = [];

            if (nativeGroup.length > 0) {
                items.push({ label: 'Current IDE', kind: vscode.QuickPickItemKind.Separator });
                nativeGroup.forEach(p => items.push({
                    label: p.name,
                    description: 'Current Environment',
                    detail: p.description,
                    provider: p
                }));
            }

            if (activeGroup.length > 0) {
                items.push({ label: 'Installed Extensions', kind: vscode.QuickPickItemKind.Separator });
                activeGroup.forEach(p => items.push({
                    label: p.name,
                    description: p.description ? `Installed  $(${p.description === 'Summaries only' ? 'warning' : 'info'}) ${p.description}` : 'Installed',
                    provider: p
                }));
            }

            if (otherGroup.length > 0) {
                items.push({ label: 'Other Detected Sources', kind: vscode.QuickPickItemKind.Separator });
                otherGroup.forEach(p => items.push({
                    label: p.name,
                    description: p.description || '',
                    provider: p
                }));
            }

            const result = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select source to save from'
            });

            if (!result || !result.provider) return;
            selectedProviderName = result.provider.name;
        }

        const reader = manager.getReader(selectedProviderName);
        if (!reader) return;

        // 2. Auto-match current workspace
        // currentWorkspace is guaranteed to be defined from the check at start


        const workspaces = await reader.getWorkspaces();
        if (workspaces.length === 0) {
            vscode.window.showInformationMessage(`No chat history found in ${reader.name}.`);
            return;
        }

        // Normalize paths for comparison (handle trailing slashes, case sensitivity on Windows)
        const normalizePath = (p: string) => path.normalize(p).toLowerCase().replace(/[\\/]+$/, '');
        const normalizedCurrent = normalizePath(currentWorkspace);

        // Try to find matching workspace
        let matchedWorkspace = workspaces.find(ws => {
            const normalizedWsPath = normalizePath(ws.path);
            // Check exact match or if workspace file path matches
            return normalizedWsPath === normalizedCurrent ||
                (ws.dbPath && normalizePath(ws.dbPath) === normalizedCurrent);
        });

        // Fallback: If no exact path match, try to match by folder name
        // This handles cases where drive letters differ (C: vs c:) or other path anomalies on Windows
        if (!matchedWorkspace) {
            const currentBasename = path.basename(normalizedCurrent);
            const candidates = workspaces.filter(ws => {
                const wsBasename = path.basename(normalizePath(ws.path));
                return wsBasename === currentBasename;
            });

            if (candidates.length > 0) {
                // Pick the most recently modified one if multiple match
                matchedWorkspace = candidates.sort((a, b) => b.lastModified - a.lastModified)[0];
                Logger.info(`[Save] Fuzzy matched workspace by name '${currentBasename}': ${matchedWorkspace.path}`);
            }
        }

        if (!matchedWorkspace) {
            vscode.window.showWarningMessage(
                `No ${reader.name} chat history found for workspace "${path.basename(currentWorkspace)}".`
            );
            return;
        }

        Logger.info(`[Save] Auto-matched workspace: ${matchedWorkspace.name} (${matchedWorkspace.chatCount} chats)`);

        // Store workspace dbPath for lazy loading during export
        const workspaceDbPath = matchedWorkspace.dbPath || matchedWorkspace.path;
        (globalThis as any).__waylog_last_workspace_path = workspaceDbPath;

        // 3. Select Sessions
        const sessions = await reader.getSessions(workspaceDbPath);
        if (sessions.length === 0) {
            vscode.window.showInformationMessage('No sessions found.');
            return;
        }

        const sessionItems = sessions.map(s => ({
            label: s.title,
            description: new Date(s.timestamp).toLocaleString(),
            session: s,
            picked: true
        }));

        const selectedSessions = await vscode.window.showQuickPick(sessionItems, {
            placeHolder: 'Select chats to save',
            canPickMany: true
        });

        if (!selectedSessions || selectedSessions.length === 0) return;

        // 4. Save
        await saveSessionsToWaylog(selectedSessions.map(item => item.session));

    } catch (error) {
        Logger.error('Save failed', error);
        vscode.window.showErrorMessage('Save failed. Check logs.');
    }
}

async function saveSessionsToWaylog(sessions: ChatSession[]) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let rootPath: string | undefined;

    if (workspaceFolders && workspaceFolders.length > 0) {
        rootPath = workspaceFolders[0].uri.fsPath;
    } else {
        // Fallback to deprecated API for compatibility
        rootPath = vscode.workspace.rootPath;
    }

    if (!rootPath) {
        vscode.window.showErrorMessage('No workspace folder is open. Please open a project first.');
        return;
    }

    const waylogDir = path.join(rootPath, '.waylog');
    const historyDir = path.join(waylogDir, 'history');

    Logger.info(`[Save] Saving to: ${historyDir}`);

    try {
        await fs.mkdir(historyDir, { recursive: true });
    } catch (e) {
        Logger.error('[Save] Failed to create .waylog/history directory', e);
        vscode.window.showErrorMessage('Failed to create .waylog/history directory');
        return;
    }

    // Get the reader and workspace path for lazy loading
    const manager = SyncManager.getInstance();
    const firstSession = sessions[0];
    const reader = manager.getReader(firstSession.source);

    // We need to get the workspace path - it should be stored in session metadata
    // For now, we'll need to pass it through. Let's add it to the session selection context.
    // WORKAROUND: Store workspace path in a module-level variable during selection
    const workspaceDbPath = (globalThis as any).__waylog_last_workspace_path;

    let count = 0;
    let updated = 0;
    let opened = 0;

    for (const session of sessions) {
        try {
            // Lazy load messages if needed (for Cursor Composer, Cline Family, etc.)
            if (session.messages.length === 0 && reader && workspaceDbPath) {
                await loadSessionContent(session, reader, workspaceDbPath);
            }

            // Skip empty sessions
            if (session.messages.length === 0) {
                Logger.info(`[Save] Skipped empty session: ${session.title}`);
                continue;
            }

            // Check if file already exists
            const existingFile = await findExistingFile(session, historyDir);

            if (existingFile) {
                // File exists - check if we need to update
                const fileMessageCount = await getFileMessageCount(existingFile);

                if (session.messages.length > fileMessageCount) {
                    // Has new messages - append incrementally
                    Logger.info(`[Save] Updating ${path.basename(existingFile)}: ${fileMessageCount} → ${session.messages.length} messages`);

                    const newMessages = session.messages.slice(fileMessageCount);
                    const newContent = newMessages.map(msg => {
                        const msgDate = msg.timestamp ? new Date(msg.timestamp).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '';
                        let headerText = '';

                        if (msg.role === 'user') {
                            headerText = `_**User (${msgDate})**_`;
                        } else {
                            const model = msg.metadata?.model || 'default';
                            const mode = msg.metadata?.mode || 'Chat';
                            headerText = `_**Assistant (model: ${model}, mode: ${mode})**_`;
                        }

                        let content = `\n${headerText}\n\n${msg.content}\n`;

                        // Add metadata (thinking, tools, todos) if present
                        if (msg.metadata?.thinking && Array.isArray(msg.metadata.thinking) && msg.metadata.thinking.length > 0) {
                            content += `\n<details>\n<summary><b>Thinking Process</b></summary>\n\n${msg.metadata.thinking.join('\n\n')}\n</details>\n`;
                        }

                        if (msg.metadata?.toolCalls && Array.isArray(msg.metadata.toolCalls)) {
                            for (const tool of msg.metadata.toolCalls) {
                                const toolName = tool.name || 'unknown_tool';
                                const status = tool.status || 'completed';
                                const summary = tool.rawArgs ? `Tool use: **${toolName}**` : `Tool result: **${toolName}**`;

                                content += `\n<tool-use data-tool-name="${toolName}">\n`;
                                content += `<details>\n<summary>${summary} • ${status}</summary>\n\n`;
                                if (tool.params) content += `**Parameters:**\n\`\`\`json\n${tool.params}\n\`\`\`\n\n`;
                                if (tool.result) {
                                    content += '**Result:**\n';
                                    try {
                                        const parsed = JSON.parse(tool.result);
                                        content += `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\`\n`;
                                    } catch (e) {
                                        content += `${tool.result}\n`;
                                    }
                                }
                                content += '</details>\n</tool-use>\n';
                            }
                        }

                        if (msg.metadata?.todos && Array.isArray(msg.metadata.todos) && msg.metadata.todos.length > 0) {
                            content += '\n**Plan Progress:**\n';
                            for (const todo of msg.metadata.todos) {
                                const icon = todo.status === 'completed' ? '✅' : (todo.status === 'in_progress' ? '⏳' : '⭕');
                                content += `- ${icon} ${todo.content || todo}\n`;
                            }
                        }

                        return content + '\n---\n';
                    }).join('\n');

                    await fs.appendFile(existingFile, newContent, 'utf8');
                    updated++;
                }

                // Open the file
                const doc = await vscode.workspace.openTextDocument(existingFile);
                await vscode.window.showTextDocument(doc);
                opened++;

                Logger.info(`[Save] Opened existing file: ${path.basename(existingFile)}`);
            } else {
                // File doesn't exist - export new file
                const filename = generateFilename(session);

                const content = formatSessionMarkdown(session);
                const filepath = path.join(historyDir, filename);
                await fs.writeFile(filepath, content, 'utf8');

                count++;
                Logger.info(`[Save] Exported ${count}/${sessions.length}: ${filename}`);
            }

            // Immediately release memory
            session.messages = [];
        } catch (error) {
            Logger.error(`[Save] Failed to process session ${session.id}`, error);
        }
    }

    let message = `Processed ${sessions.length} chats: `;
    if (count > 0) message += `${count} new, `;
    if (updated > 0) message += `${updated} updated, `;
    if (opened > 0) message += `${opened} opened`;

    vscode.window.showInformationMessage(message);
}
