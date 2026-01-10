import { CursorParser, CursorBubble, CursorTab } from '../src/services/readers/cursor-parser';
import { ChatMessage } from '../src/services/readers/types';

describe('CursorParser', () => {
    describe('parseBubbles', () => {
        const mockBubbles: CursorBubble[] = [
            {
                id: '1',
                type: 1, // user
                text: 'Hello',
                createdAt: 1000
            },
            {
                id: '2',
                type: 2, // assistant
                text: 'Hi there',
                createdAt: 2000
            },
            {
                id: '3',
                type: 2, // assistant
                text: 'How can I help?',
                createdAt: 3000
            },
            {
                id: '4',
                type: 1, // user
                text: 'New question',
                createdAt: 4000
            }
        ];

        it('should map roles and sort by timestamp', () => {
            const outOfOrder = [mockBubbles[1], mockBubbles[0]];
            const result = CursorParser.parseBubbles(outOfOrder);
            expect(result[0].role).toBe('user');
            expect(result[1].role).toBe('assistant');
        });

        it('should merge consecutive assistant messages', () => {
            const result = CursorParser.parseBubbles(mockBubbles);
            expect(result.length).toBe(3); // user, assistant (merged), user
            expect(result[1].role).toBe('assistant');
            expect(result[1].content).toContain('Hi there');
            expect(result[1].content).toContain('How can I help?');
        });

        it('should handle Lexical rich text format', () => {
            const richBubble: CursorBubble = {
                type: 2,
                richText: JSON.stringify({
                    root: {
                        children: [
                            { children: [{ text: 'Deep' }] },
                            { children: [{ text: 'Think' }] }
                        ]
                    }
                }),
                createdAt: 1000
            };
            const result = CursorParser.parseBubbles([richBubble]);
            expect(result[0].content).toBe('Deep\nThink');
        });

        it('should skip bubbles with no content', () => {
            const emptyBubbles: CursorBubble[] = [
                { type: 1, text: '', createdAt: 1000 },
                { type: 2, text: 'Valid', createdAt: 2000 }
            ];
            const result = CursorParser.parseBubbles(emptyBubbles);
            expect(result.length).toBe(1);
            expect(result[0].content).toBe('Valid');
        });
    });

    describe('isValidComposer', () => {
        it('should be valid if it has a custom name', () => {
            expect(CursorParser.isValidComposer({ composerId: 'id', name: 'My Task' })).toBe(true);
            expect(CursorParser.isValidComposer({ composerId: 'id', name: 'Untitled Composer' })).toBe(false);
        });

        it('should be valid if it has a subtitle', () => {
            expect(CursorParser.isValidComposer({ composerId: 'id', subtitle: 'Some context' })).toBe(true);
        });

        it('should be valid if it has code changes', () => {
            expect(CursorParser.isValidComposer({ composerId: 'id', totalLinesAdded: 5 })).toBe(true);
            expect(CursorParser.isValidComposer({ composerId: 'id', totalLinesRemoved: 2 })).toBe(true);
        });

        it('should be valid if it has been active for more than 5 seconds', () => {
            expect(CursorParser.isValidComposer({
                composerId: 'id',
                createdAt: 1000,
                lastUpdatedAt: 7000
            })).toBe(true);

            expect(CursorParser.isValidComposer({
                composerId: 'id',
                createdAt: 1000,
                lastUpdatedAt: 2000
            })).toBe(false);
        });
    });

    describe('parseComposers', () => {
        it('should map composer metadata to ChatSession', () => {
            const composers = [
                {
                    composerId: 'c1',
                    name: 'Task 1',
                    unifiedMode: 'agent',
                    createdAt: 123456789
                }
            ];
            const result = CursorParser.parseComposers(composers, 'Cursor');
            expect(result[0].id).toBe('c1');
            expect(result[0].title).toBe('Task 1');
            expect(result[0].description).toBe('agent Mode');
            expect(result[0].source).toBe('Cursor');
        });

        it('should fall back to subtitle for title if name is missing', () => {
            const composers = [
                {
                    composerId: 'c1',
                    subtitle: 'Fixing the bug in the refactoring logic'
                }
            ];
            const result = CursorParser.parseComposers(composers, 'Cursor');
            expect(result[0].title).toBe('Fixing the bug in the refactoring logic');
        });
    });

    describe('parseLegacyTabMessages', () => {
        it('should parse bubbles with both string and numeric types', () => {
            const tab: CursorTab = {
                tabId: 't1',
                bubbles: [
                    { type: 'user', text: 'Hey', createdAt: 1000 },
                    { type: 2, text: 'Hello', createdAt: 2000 }
                ]
            };
            const result = CursorParser.parseLegacyTabMessages(tab);
            expect(result[0].role).toBe('user');
            expect(result[1].role).toBe('assistant');
        });
    });
});
