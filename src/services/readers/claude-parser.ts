
import { ChatSession, ChatMessage } from './types';
import * as crypto from 'crypto';

export interface ClaudeEvent {
    type: string;
    sessionId?: string;
    cwd?: string;
    timestamp?: string;
    uuid?: string;
    parentUuid?: string;
    isSidechain?: boolean;
    message?: ClaudeMessageInternal;
    gitBranch?: string; // Present in VS Code version
    slug?: string;      // Present in CLI version
    error?: string;     // Present in error events
    isApiErrorMessage?: boolean;
    isMeta?: boolean;   // Meta messages (caveats, system messages)
    summary?: string;   // Summary events
}

export interface ClaudeMessageInternal {
    id?: string;
    role: string;
    content: ClaudeContent;
    model?: string;
    // usage can be null or undefined
    usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
    };
}

export type ClaudeContent = string | ClaudeContentItem[];

export interface ClaudeContentItem {
    type: string;
    text?: string;
    name?: string; // For tool_use
    // other fields like input, output etc for tool use
}

export class ClaudeParser {
    /**
     * Parse a full JSONL session content string into a ChatSession object.
     * Returns null if the session is invalid or empty.
     */
    static parseSession(content: string, fileName: string = 'unknown', creationTime: number = 0, debug: boolean = false): ChatSession | null {
        const lines = content.split(/\r?\n/);
        const messages: ChatMessage[] = [];
        let sessionId = '';
        // Use creationTime as default timestamp if available, otherwise current time
        // This prevents creating new files every sync for sessions without internal timestamps
        let startedAt = creationTime > 0 ? creationTime : Date.now();
        let projectPath = '';
        const eventTypeCounts: Record<string, number> = {};

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const event = JSON.parse(line) as ClaudeEvent;

                // Track event types for debugging
                eventTypeCounts[event.type] = (eventTypeCounts[event.type] || 0) + 1;

                // Extract session metadata from the first valid event
                if (!sessionId && event.sessionId) {
                    sessionId = event.sessionId;
                }

                // Fallback session ID from filename if not found in events
                if (!sessionId && fileName) {
                    sessionId = fileName.replace(/\.jsonl$/, '');
                }

                if (!projectPath && event.cwd) {
                    projectPath = event.cwd;
                }

                // Parse user and assistant messages
                if (event.type === 'user' || event.type === 'assistant') {
                    // Pass creationTime as fallback for messages without explicit timestamp
                    const msg = this.parseMessage(event, creationTime);
                    if (msg) {
                        if (messages.length === 0 && msg.timestamp) {
                            startedAt = msg.timestamp;
                        }
                        messages.push(msg);
                    }
                }
            } catch (e) {
                // Ignore malformed lines
                continue;
            }
        }

        if (debug && messages.length === 0) {
            console.log(`[ClaudeParser] ${fileName}: No messages parsed. Event types:`, eventTypeCounts);
        }

        if (messages.length === 0) {
            return null;
        }

        return {
            id: sessionId,
            // Title logic: Find first user message with actual text content (skip tool-use only or empty/meta messages)
            title: messages.find(m => m.role === 'user' && m.content && m.content.trim().length > 0 && !m.content.startsWith('> ⎿'))?.content.slice(0, 50) || sessionId,
            // Description logic: Message count by type or total
            description: `Chat (${messages.length} msg)`,
            timestamp: startedAt,
            lastUpdatedAt: messages[messages.length - 1]?.timestamp || startedAt,
            messages,
            source: 'Claude'
        };
    }

    /**
     * Parse a single Claude event into a standardized ChatMessage.
     */
    static parseMessage(event: ClaudeEvent, defaultTimestamp: number = 0): ChatMessage | null {
        // Map role to specific types
        let role: 'user' | 'assistant' = 'user';
        if (event.type === 'assistant') {
            role = 'assistant';
        } else if (event.type === 'user') {
            role = 'user';
        } else if (event.type === 'summary') {
            // Summary events are treated as assistant messages
            role = 'assistant';
        } else {
            return null;
        }

        let content = '';
        let model: string | undefined;
        let tokens: { input: number; output: number; cached: number } | undefined;
        const toolCalls: string[] = [];

        // Handle summary events
        if (event.type === 'summary' && event.summary) {
            content = `[Summary] ${event.summary}`;
        }
        // Handle normal messages
        else if (event.message) {
            // Extract content
            if (typeof event.message.content === 'string') {
                content = event.message.content;
            } else if (Array.isArray(event.message.content)) {
                content = event.message.content
                    .map(item => {
                        if (item.type === 'text') {
                            return item.text || '';
                        }
                        if (item.type === 'tool_use') {
                            if (item.name) toolCalls.push(item.name);
                        }
                        return '';
                    })
                    .join('\n');
            }

            model = event.message.model;

            if (event.message.usage) {
                tokens = {
                    input: event.message.usage.input_tokens || 0,
                    output: event.message.usage.output_tokens || 0,
                    cached: event.message.usage.cache_read_input_tokens || 0
                };
            }
        }
        // Handle error messages (VS Code style 2.1.3)
        else if (event.isApiErrorMessage && event.error) {
            content = `Error: ${event.error}`;
        }

        // Don't skip meta messages - they may contain useful context
        // Only skip if truly empty
        if (!content && !toolCalls.length && !event.error && !event.summary) {
            return null;
        }

        // If content extracted empty but it was an error
        if (!content && event.error) {
            content = `Error: ${event.error}`;
        }

        // Format XML tags for CLI-style output
        if (role === 'user') {
            // Filter out internal IDE state messages (ide_opened_file, ide_edit_file, etc.)
            // We use a regex to match ANY tag starting with <ide_ and ending with </ide_...>
            // If the message is purely these tags (whitespace allowed), we skip it.
            // If there is other content (user typed text), we keep the text.

            // 1. Remove all ide_ tags to check for "real" content
            const cleanContent = content.replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, '').trim();

            if (!cleanContent) {
                // If nothing remains after removing tags, it was purely internal state -> Skip
                return null;
            }

            // 2. If we have real content, use it (removing the tags)
            content = cleanContent;
            content = this.formatClaudeXml(content);
        }

        // Final check: If content is empty/whitespace, skip this message
        // We purposefully ignore toolCalls here - if there is no text content to show,
        // we generally don't want to show an empty block just for tool metadata.
        if (!content.trim() && !event.error) {
            return null;
        }

        const fallback = defaultTimestamp > 0 ? defaultTimestamp : Date.now();
        const msg: ChatMessage = {
            role,
            content,
            timestamp: event.timestamp ? new Date(event.timestamp).getTime() : fallback,
            metadata: {
                id: event.uuid || crypto.randomUUID(),
                model,
                tokens,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined
            }
        };

        return msg;
    }

    /**
     * Format specific XML tags used by Claude Code into readable text.
     */
    static formatClaudeXml(content: string): string {
        // Handle <command-name>cmd</command-name>
        const cmdMatch = content.match(/<command-name>(.*?)<\/command-name>/s);
        if (cmdMatch) {
            const cmd = cmdMatch[1].trim();
            if (cmd.startsWith('/')) {
                return `> ${cmd}`;
            }
        }

        // Handle <local-command-stdout>output</local-command-stdout>
        const outMatch = content.match(/<local-command-stdout>(.*?)<\/local-command-stdout>/s);
        if (outMatch) {
            const out = outMatch[1].trim();
            return `> ⎿ ${out}`;
        }

        return content;
    }

    /**
     * Quickly check if a session file is a sidechain (helper agent)
     * without parsing the whole file. Read first few lines.
     */
    static isSidechain(firstFewLines: string): boolean {
        if (firstFewLines.includes('"isSidechain":true')) return true;
        return false;
    }
}
