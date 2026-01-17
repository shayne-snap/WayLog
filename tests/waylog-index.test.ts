import { generateFilename } from '../src/services/waylog-index';
import { ChatSession } from '../src/services/readers/types';

describe('generateFilename', () => {
    const baseTimestamp = new Date('2026-01-10T11:04:56.123Z').getTime();

    it('should generate waylog-cli compatible filename for Claude sessions', () => {
        const claudeSession: ChatSession = {
            id: 'test-session-123',
            title: 'Test Session',
            timestamp: baseTimestamp,
            source: 'Claude',
            messages: [
                {
                    role: 'user',
                    content: 'How do I implement a CLI tool?',
                    timestamp: baseTimestamp
                }
            ],
            lastUpdatedAt: baseTimestamp
        };

        const filename = generateFilename(claudeSession);

        // Expected format: YYYY-MM-DD_HH-MM-SSZ-claude-{slug}.md
        expect(filename).toBe('2026-01-10_11-04-56Z-claude-how-do-i-implement-a-cli-tool.md');
    });

    it('should handle special characters in Claude slugs', () => {
        const claudeSession: ChatSession = {
            id: 'test-session-456',
            title: 'Test Session',
            timestamp: baseTimestamp,
            source: 'Claude',
            messages: [
                {
                    role: 'user',
                    content: 'Who are you?',
                    timestamp: baseTimestamp
                }
            ],
            lastUpdatedAt: baseTimestamp
        };

        const filename = generateFilename(claudeSession);
        expect(filename).toBe('2026-01-10_11-04-56Z-claude-who-are-you.md');
    });

    it('should collapse multiple hyphens in Claude slugs', () => {
        const claudeSession: ChatSession = {
            id: 'test-session-789',
            title: 'Test Session',
            timestamp: baseTimestamp,
            source: 'Claude',
            messages: [
                {
                    role: 'user',
                    content: 'Hello   World!!!',
                    timestamp: baseTimestamp
                }
            ],
            lastUpdatedAt: baseTimestamp
        };

        const filename = generateFilename(claudeSession);
        expect(filename).toBe('2026-01-10_11-04-56Z-claude-hello-world.md');
    });

    it('should use session ID as fallback for Claude when no user message', () => {
        const claudeSession: ChatSession = {
            id: 'fallback-session-id',
            title: 'Test Session',
            timestamp: baseTimestamp,
            source: 'Claude',
            messages: [],
            lastUpdatedAt: baseTimestamp
        };

        const filename = generateFilename(claudeSession);
        expect(filename).toBe('2026-01-10_11-04-56Z-claude-fallback-session-id.md');
    });

    it('should keep original format for Cursor sessions', () => {
        const cursorSession: ChatSession = {
            id: 'cursor-session-123',
            title: 'My Cursor Chat',
            timestamp: baseTimestamp,
            source: 'Cursor',
            messages: [],
            lastUpdatedAt: baseTimestamp
        };

        const filename = generateFilename(cursorSession);

        // Expected original format: YYYY-MM-DD_HH-MMZ-{title}.md
        expect(filename).toBe('2026-01-10_11-04Z-My_Cursor_Chat.md');
    });

    it('should keep original format for other providers', () => {
        const clineSession: ChatSession = {
            id: 'cline-session-123',
            title: 'Cline Session',
            timestamp: baseTimestamp,
            source: 'Cline',
            messages: [],
            lastUpdatedAt: baseTimestamp
        };

        const filename = generateFilename(clineSession);
        expect(filename).toBe('2026-01-10_11-04Z-Cline_Session.md');
    });

    it('should truncate long slugs to 50 characters for Claude', () => {
        const longContent = 'a'.repeat(100);
        const claudeSession: ChatSession = {
            id: 'test-long',
            title: 'Test',
            timestamp: baseTimestamp,
            source: 'Claude',
            messages: [
                {
                    role: 'user',
                    content: longContent,
                    timestamp: baseTimestamp
                }
            ],
            lastUpdatedAt: baseTimestamp
        };

        const filename = generateFilename(claudeSession);
        const slug = filename.split('-claude-')[1].replace('.md', '');

        expect(slug.length).toBeLessThanOrEqual(50);
        expect(slug).toBe('a'.repeat(50));
    });
});
