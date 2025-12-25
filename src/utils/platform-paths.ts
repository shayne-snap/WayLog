import * as os from 'os';
import * as path from 'path';

/**
 * Utility to get platform-specific application data paths.
 * Handles the differences between macOS (Darwin), Windows (win32), and Linux.
 */
export class PlatformPaths {
    /**
     * Get the base directory for application support/data.
     * - macOS: ~/Library/Application Support
     * - Windows: %APPDATA%
     * - Linux: ~/.config
     */
    static getAppDataPath(): string {
        switch (process.platform) {
            case 'darwin':
                return path.join(os.homedir(), 'Library', 'Application Support');
            case 'win32':
                return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
            case 'linux':
                return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
            default:
                // Fallback to home dir for unknown platforms
                return os.homedir();
        }
    }

    /**
     * Get Cursor IDE storage base path
     */
    static getCursorStoragePath(): string {
        const base = this.getAppDataPath();
        return path.join(base, 'Cursor', 'User', 'workspaceStorage');
    }

    /**
     * Get Cursor IDE global storage path
     */
    static getCursorGlobalStoragePath(): string {
        const base = this.getAppDataPath();
        return path.join(base, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    }

    /**
     * Get CodeBuddy data path
     */
    static getCodeBuddyDataPath(): string {
        // CodeBuddy path logic might vary, but standardizing on AppData is safe for checking
        // Based on research:
        // Mac: ~/Library/Application Support/CodeBuddyExtension/Data
        // Windows: Seems to use home dir ~/.codebuddy based on some docs, but standard extension data usually in AppData
        // Let's support both standard AppData and the home dir fallback if needed.

        if (process.platform === 'darwin') {
            return path.join(os.homedir(), 'Library', 'Application Support', 'CodeBuddyExtension', 'Data');
        } else if (process.platform === 'win32') {
            // Windows fallback check both AppData and Home
            // For now return AppData standard, caller can check alternatives
            return path.join(process.env.APPDATA || '', 'CodeBuddyExtension', 'Data');
        } else {
            return path.join(os.homedir(), '.codebuddy');
        }
    }

    /**
     * Get VS Code Global Storage path (for Cline/Roo Code etc)
     * Handles both Stable and Insiders
     */
    static getVSCodeGlobalStoragePath(): string {
        const base = this.getAppDataPath();
        // Return base path, caller usually appends 'Code/User/globalStorage' or similar
        return base;
    }
}
