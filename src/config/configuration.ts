import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export enum ConfigKey {
    Enable = 'enable',
    AutoSave = 'autoSave',
    ShowWelcome = 'showWelcome'
}

export class ConfigurationManager {
    private static readonly SECTION = 'waylog';
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.registerListeners();
    }

    public get<T>(key: ConfigKey, defaultValue?: T): T | undefined {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        const value = config.get<T>(key);
        return value !== undefined ? value : defaultValue;
    }

    public async update(key: ConfigKey, value: any, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global): Promise<void> {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.SECTION);
        await config.update(key, value, target);
    }

    public get isEnabled(): boolean {
        return this.get<boolean>(ConfigKey.Enable, true) ?? true;
    }

    public get isAutoSaveEnabled(): boolean {
        return this.get<boolean>(ConfigKey.AutoSave, true) ?? true;
    }

    private registerListeners() {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration(ConfigurationManager.SECTION)) {
                    this.onConfigChanged();
                }
            })
        );
    }

    private onConfigChanged() {
        Logger.info('Configuration changed');
        if (this.isEnabled) {
            vscode.window.showInformationMessage('WayLog settings updated');
        }
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
