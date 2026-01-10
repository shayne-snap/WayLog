import { ChatMessage, ChatSession } from './types';

/**
 * Interfaces for Cursor's internal data structures
 */
export interface CursorBubble {
    id?: string;
    bubbleId?: string;
    text?: string;
    richText?: string;
    type?: number | string; // 1/'user': user, 2/'assistant': assistant
    modelType?: string;
    createdAt?: number | string;
    [key: string]: any;
}

export interface CursorTab {
    tabId: string;
    chatTitle?: string;
    lastUpdatedAt?: number;
    bubbles?: CursorBubble[];
}

/**
 * Utility for parsing Cursor-specific data formats.
 */
export class CursorParser {
    /**
     * Converts a list of raw Cursor bubbles into unified ChatMessages.
     * Handles role mapping, rich text parsing, and merging of consecutive assistant messages.
     */
    static parseBubbles(bubbles: CursorBubble[]): ChatMessage[] {
        // 1. Sort by creation time
        const sortedBubbles = [...bubbles].sort((a, b) =>
            (new Date(a.createdAt || 0).getTime()) - (new Date(b.createdAt || 0).getTime())
        );

        const messages: ChatMessage[] = [];
        let currentAssistantMessage: { content: string; timestamp: number } | null = null;

        for (const b of sortedBubbles) {
            const content = this.extractTextContent(b);
            const isUser = b.type === 1 || b.type === 'user';
            const role = isUser ? 'user' : 'assistant';

            // Skip bubbles with no content (pure tool calls or thinking)
            if (!content) continue;

            const timestamp = b.createdAt ? new Date(b.createdAt).getTime() : Date.now();

            if (role === 'user') {
                // Flush any pending assistant message
                if (currentAssistantMessage) {
                    messages.push({
                        role: 'assistant',
                        content: currentAssistantMessage.content.trim(),
                        timestamp: currentAssistantMessage.timestamp,
                        metadata: {}
                    });
                    currentAssistantMessage = null;
                }

                // Add user message
                messages.push({
                    role: 'user',
                    content: content.trim(),
                    timestamp: timestamp,
                    metadata: {}
                });
            } else {
                // Assistant message - merge with previous if exists
                if (currentAssistantMessage) {
                    currentAssistantMessage.content += '\n\n' + content;
                } else {
                    currentAssistantMessage = {
                        content: content,
                        timestamp: timestamp
                    };
                }
            }
        }

        // Final flush
        if (currentAssistantMessage) {
            messages.push({
                role: 'assistant',
                content: currentAssistantMessage.content.trim(),
                timestamp: currentAssistantMessage.timestamp,
                metadata: {}
            });
        }

        return messages;
    }

    /**
     * Extracts plain text from a bubble, handling Lexical rich text if present.
     */
    static extractTextContent(bubble: CursorBubble): string {
        let content = bubble.text || '';

        if (!content && bubble.richText) {
            try {
                const rt = JSON.parse(bubble.richText);
                if (rt.root?.children) {
                    content = this.parseLexicalNodes(rt.root.children);
                }
            } catch (e) {
                // Fallback to empty if parse fails
            }
        }

        return content.trim();
    }

    /**
     * Recursively parses Lexical JSON nodes into plain text.
     */
    private static parseLexicalNodes(nodes: any[]): string {
        return nodes
            .map((node: any) => {
                if (node.text) return node.text;
                if (node.children) return this.parseLexicalNodes(node.children);
                return '';
            })
            .join('\n')
            .trim();
    }

    /**
     * Parses legacy chat tabs into ChatMessages.
     */
    static parseLegacyTabMessages(tab: CursorTab): ChatMessage[] {
        if (!tab.bubbles) return [];

        return tab.bubbles
            .map(b => {
                const text = b.text || b.modelResponse;
                if (!text) return null;

                const isUser = b.type === 'user' || b.type === 1;
                return {
                    role: isUser ? 'user' : 'assistant',
                    content: text as string,
                    timestamp: tab.lastUpdatedAt || Date.now(),
                    metadata: { model: b.modelType || 'unknown', type: 'legacy' }
                } as ChatMessage;
            })
            .filter((m): m is ChatMessage => m !== null);
    }

    /**
     * Checks if a composer session is substantial enough to be exported (not empty/untitled).
     */
    static isValidComposer(comp: any): boolean {
        if (!comp.composerId) return false;

        const hasCustomName = comp.name && comp.name !== 'Untitled Composer';
        const hasSubtitle = !!comp.subtitle;
        const hasCodeChanges = (comp.totalLinesAdded || 0) > 0 || (comp.totalLinesRemoved || 0) > 0;
        const lastUpdate = comp.lastUpdatedAt || comp.createdAt || 0;
        const isActive = (lastUpdate - (comp.createdAt || 0)) > 5000;

        return !!(hasCustomName || hasSubtitle || hasCodeChanges || isActive);
    }

    /**
     * Parses composer metadata into ChatSessions (without full message content).
     */
    static parseComposers(composers: any[], sourceName: string): ChatSession[] {
        return composers
            .filter(comp => this.isValidComposer(comp))
            .map(comp => {
                let title = comp.name || 'Untitled Composer';
                if (title === 'Untitled Composer' && comp.subtitle) {
                    title = comp.subtitle.slice(0, 50);
                }

                return {
                    id: comp.composerId,
                    title,
                    description: `${comp.unifiedMode || 'Agent'} Mode`,
                    timestamp: comp.createdAt || comp.lastUpdatedAt || Date.now(),
                    lastUpdatedAt: comp.lastUpdatedAt || comp.createdAt || Date.now(),
                    messages: [], // Lazy loaded
                    source: sourceName
                };
            });
    }
}
