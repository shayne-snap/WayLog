import * as path from 'path';
import { WorkspaceInfo } from '../services/readers/types';

/**
 * Utility class for matching workspaces based on paths.
 * Handles normalization and cross-platform path differences.
 */
export class WorkspaceMatcher {
    /**
     * Finds the best matching workspace from a list of candidates.
     *
     * @param workspaces List of available workspaces from a provider
     * @param currentWorkspaceRoot The current workspace folder path
     * @param vscodeWorkspaceFile Optional: The current .code-workspace file path if any
     * @returns The matching workspace or undefined
     */
    static findBestMatch(
        workspaces: WorkspaceInfo[],
        currentWorkspaceRoot: string,
        vscodeWorkspaceFile?: string
    ): WorkspaceInfo | undefined {
        if (!workspaces.length) return undefined;

        const normalizedRoot = this.normalizePath(currentWorkspaceRoot);
        const normalizedWsFile = vscodeWorkspaceFile ? this.normalizePath(vscodeWorkspaceFile) : undefined;

        // 1. Try exact matches first (Priority: .code-workspace file > folder path)
        const match = workspaces.find(ws => {
            const normalizedWsPath = this.normalizePath(ws.path);

            // Check .code-workspace match
            if (normalizedWsFile && normalizedWsPath === normalizedWsFile) {
                return true;
            }

            // Check folder path match
            return normalizedWsPath === normalizedRoot;
        });

        if (match) return match;

        // 2. Fuzzy Match: Match by folder name (basename)
        // Solves drive letter or path format mismatch issues on Windows
        const currentBasename = path.basename(normalizedRoot);
        const candidates = workspaces.filter(ws => {
            const wsBasename = path.basename(this.normalizePath(ws.path));
            return wsBasename === currentBasename;
        });

        if (candidates.length > 0) {
            // Pick the most recently modified one if multiple match
            return candidates.sort((a, b) => b.lastModified - a.lastModified)[0];
        }

        return undefined;
    }

    /**
     * Normalizes a path for consistent comparison.
     * Replaces backslashes with forward slashes to handle Windows paths on POSIX.
     */
    private static normalizePath(p: string): string {
        const unifiedPath = p.replace(/\\/g, '/');
        return path.normalize(unifiedPath).toLowerCase();
    }
}
