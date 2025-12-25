import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { ChatSession } from './readers/types';

/**
 * Generate filename for a session
 * Uses session creation time + title
 */
export function generateFilename(session: ChatSession): string {
    const date = new Date(session.timestamp);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = date.toISOString().split('T')[1].slice(0, 5).replace(':', '-'); // HH-MM
    const sanitizedTitle = session.title.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_').slice(0, 50);
    return `${dateStr}_${timeStr}Z-${sanitizedTitle}.md`;
}

/**
 * Find existing exported file for a given session
 * Simply checks if file with expected name exists
 */
export async function findExistingFile(session: ChatSession, historyDir: string): Promise<string | null> {
    try {
        const filename = generateFilename(session);
        const filepath = path.join(historyDir, filename);

        // Check if file exists
        try {
            await fs.access(filepath);
            const stats = await fs.stat(filepath);
            Logger.debug(`[WayLog] Found existing file: ${filename} (size: ${stats.size} bytes)`);
            return filepath;
        } catch {
            // File doesn't exist or is inaccessible
            return null;
        }
    } catch (error) {
        Logger.error('[WayLog] Error finding existing file', error);
        return null;
    }
}

/**
 * Extract message count from exported markdown file
 * Counts the number of message separators (---) in the file
 */
export async function getFileMessageCount(filepath: string): Promise<number> {
    try {
        const content = await fs.readFile(filepath, 'utf8');

        // Count message separators
        // Each message ends with "\n---\n"
        const separators = content.match(/\n---\n/g);
        const count = separators ? separators.length : 0;

        Logger.debug(`[WayLog] File ${path.basename(filepath)} has ${count} messages`);
        return count;
    } catch (error) {
        Logger.error(`[WayLog] Error reading file message count`, error);
        return 0;
    }
}

/**
 * Extract session ID from file header
 */
export function extractSessionIdFromHeader(header: string): string | null {
    const match = header.match(/Session ([a-f0-9-]+)/);
    return match ? match[1] : null;
}
