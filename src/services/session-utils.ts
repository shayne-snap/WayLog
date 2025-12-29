import { ChatSession, ChatHistoryReader } from './readers/types';
import { Logger } from '../utils/logger';

/**
 * Load session content using lazy loading if needed.
 * This is used by both auto-sync and manual import to ensure consistency.
 */
export async function loadSessionContent(
    session: ChatSession,
    reader: ChatHistoryReader,
    workspaceDbPath: string
): Promise<void> {
    if (session.messages.length === 0) {
        Logger.debug(`[SessionUtils] Lazy-loading content for session ${session.id}`);
        const readerWithFetch = reader as any;
        if (readerWithFetch.fetchSessionContent) {
            session.messages = await readerWithFetch.fetchSessionContent(session.id, workspaceDbPath);
            Logger.debug(`[SessionUtils] Loaded ${session.messages.length} messages`);
        }
    }
}

/**
 * Format a chat session as Markdown.
 * This is the unified formatting function used by both auto-sync and manual import.
 * Format aligned with Cursor's official export format for better readability and reusability.
 */
export function formatSessionMarkdown(session: ChatSession): string {
    // Format export timestamp like Cursor: "12/29/2025 at 09:45:49 GMT+8"
    const now = new Date();
    const exportDate = now.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(',', ' at');

    // Get timezone offset
    const tzOffset = -now.getTimezoneOffset();
    const tzHours = Math.floor(Math.abs(tzOffset) / 60);
    const tzMins = Math.abs(tzOffset) % 60;
    const tzString = `GMT${tzOffset >= 0 ? '+' : '-'}${tzHours}${tzMins > 0 ? ':' + tzMins : ''}`;

    // Simple title without timestamp (Cursor style)
    let header = `# ${session.title}\n`;
    header += `_Exported on ${exportDate} ${tzString} from ${session.source} via WayLog_\n\n`;

    const body = session.messages.map(msg => {
        // Simple role markers: **User** or **Cursor** (no timestamps, no model info)
        const roleName = msg.role === 'user' ? 'User' : session.source;
        const headerText = `**${roleName}**`;

        // Only include the main content, no metadata
        const content = `\n${headerText}\n\n${msg.content}\n`;

        return content + `\n---\n`;
    }).join('\n');

    return header + body;
}

/**
 * Format new messages for incremental append.
 * Used when updating existing files with new messages.
 * Note: This function doesn't have access to session.source, so it uses 'Assistant' as fallback.
 * For Cursor sessions, the role will show as 'Assistant' instead of 'Cursor'.
 */
export function formatMessages(messages: ChatSession['messages'], sourceName: string = 'Assistant'): string {
    return messages.map(msg => {
        // Simple role markers: **User** or **{Source}** (no timestamps, no model info)
        const roleName = msg.role === 'user' ? 'User' : sourceName;
        const headerText = `**${roleName}**`;

        // Only include the main content, no metadata
        const content = `\n${headerText}\n\n${msg.content}\n`;

        return content + `\n---\n`;
    }).join('\n');
}
