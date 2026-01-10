import { formatSessionMarkdown, formatMessages } from '../src/services/session-utils';
import { ChatSession } from '../src/services/readers/types';

describe('SessionUtils', () => {
    const mockSession: ChatSession = {
        id: 'test-id',
        title: 'Test Session',
        description: 'Test session for unit testing',
        source: 'Cursor',
        timestamp: 1640995200000,
        lastUpdatedAt: 1640995200000,
        messages: [
            {
                role: 'user',
                content: 'Hello',
                timestamp: 1640995200000
            },
            {
                role: 'assistant',
                content: 'Hi there!',
                timestamp: 1640995205000
            }
        ]
    };

    describe('formatSessionMarkdown', () => {
        it('should format session as markdown with correct title and source', () => {
            const result = formatSessionMarkdown(mockSession);

            expect(result).toContain('# Test Session');
            expect(result).toContain('from Cursor via WayLog');
            expect(result).toContain('**User**');
            expect(result).toContain('**Cursor**');
            expect(result).toContain('Hello');
            expect(result).toContain('Hi there!');
        });
    });

    describe('formatMessages', () => {
        it('should format individual messages correctly', () => {
            const messages = [
                { role: 'user' as const, content: 'Test user message', timestamp: 123 },
                { role: 'assistant' as const, content: 'Test assistant message', timestamp: 456 }
            ];

            const result = formatMessages(messages, 'Cursor');

            expect(result).toContain('**User**');
            expect(result).toContain('**Cursor**');
            expect(result).toContain('Test user message');
            expect(result).toContain('Test assistant message');
        });

        it('should fallback to Assistant if sourceName is not provided', () => {
            const messages = [
                { role: 'assistant' as const, content: 'Test assistant message', timestamp: 456 }
            ];

            const result = formatMessages(messages);

            expect(result).toContain('**Assistant**');
            expect(result).toContain('Test assistant message');
        });
    });
});
