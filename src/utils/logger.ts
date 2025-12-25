import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    ERROR = 2
}

export class Logger {
    private static _outputChannel: vscode.OutputChannel;
    private static _level: LogLevel = LogLevel.INFO; // Default to INFO, change to DEBUG for dev

    public static get outputChannel(): vscode.OutputChannel {
        if (!this._outputChannel) {
            this._outputChannel = vscode.window.createOutputChannel('WayLog');
        }
        return this._outputChannel;
    }

    public static setLevel(level: LogLevel) {
        this._level = level;
    }

    public static info(message: string): void {
        if (this._level > LogLevel.INFO) return;
        this.outputChannel.appendLine(`[INFO] ${message}`);
    }

    public static debug(message: string): void {
        if (this._level > LogLevel.DEBUG) return;
        this.outputChannel.appendLine(`[DEBUG] ${message}`);
    }

    public static error(message: string, error?: any): void {
        if (this._level > LogLevel.ERROR) return;
        this.outputChannel.appendLine(`[ERROR] ${message}`);
        if (error) {
            if (error instanceof Error) {
                this.outputChannel.appendLine(error.stack || error.message);
            } else {
                this.outputChannel.appendLine(JSON.stringify(error, null, 2));
            }
        }
    }

    public static show(): void {
        this.outputChannel.show();
    }
}
