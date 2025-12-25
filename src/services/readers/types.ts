export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: number;
    metadata?: any;
}

export interface ChatSession {
    id: string;
    title: string;
    description: string;
    timestamp: number; // Creation time used for filename
    lastUpdatedAt?: number; // Last modification time used for sync optimization
    messages: ChatMessage[];
    originalData?: any;
    source: string; // 'CodeBuddy', etc.
    metadata?: Record<string, any>; // Additional metadata (e.g., subChannel for Cline Family)
}

export interface WorkspaceInfo {
    id: string;
    name: string;
    path: string; // Project folder path
    dbPath?: string; // Database path (for readers that need it)
    lastModified: number;
    chatCount: number;
    source: string;
}

export interface ChatHistoryReader {
    readonly name: string;
    readonly description: string;
    extensionId?: string; // Optional: VS Code extension ID for UI grouping (e.g. 'publisher.name')

    /**
     * Checks if this source is available on the current system 
     * (e.g., is the app installed / data directory exists?)
     */
    isAvailable(): Promise<boolean>;

    /**
     * Scans and returns available workspaces containing chat history
     */
    getWorkspaces(): Promise<WorkspaceInfo[]>;

    /**
     * Reads chat sessions from a specific workspace
     * @param workspacePath The 'path' property from WorkspaceInfo
     */
    getSessions(workspacePath: string): Promise<ChatSession[]>;
}
