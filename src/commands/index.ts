import * as vscode from 'vscode';
import { saveHistoryCommand } from './save-history';

export function registerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('waylog.saveHistory', () => {
            saveHistoryCommand();
        })
    );
}
