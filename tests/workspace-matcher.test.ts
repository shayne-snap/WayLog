import { WorkspaceMatcher } from '../src/utils/workspace-matcher';
import { WorkspaceInfo } from '../src/services/readers/types';

describe('WorkspaceMatcher', () => {
    const mockWorkspaces: WorkspaceInfo[] = [
        {
            id: 'ws1',
            name: 'Project A',
            path: '/users/test/projects/project-a',
            lastModified: 1000,
            chatCount: 5,
            source: 'Cursor'
        },
        {
            id: 'ws2',
            name: 'Project B',
            path: 'C:\\Users\\Test\\Projects\\Project-B',
            lastModified: 2000,
            chatCount: 3,
            source: 'Cursor'
        },
        {
            id: 'ws3',
            name: 'Project C',
            path: '/users/test/workspace/my.code-workspace',
            lastModified: 3000,
            chatCount: 1,
            source: 'Cursor'
        }
    ];

    it('should find exact folder match', () => {
        const result = WorkspaceMatcher.findBestMatch(mockWorkspaces, '/users/test/projects/project-a');
        expect(result?.id).toBe('ws1');
    });

    it('should find exact match regardless of case (Windows-style)', () => {
        const result = WorkspaceMatcher.findBestMatch(mockWorkspaces, 'c:\\users\\test\\projects\\project-b');
        expect(result?.id).toBe('ws2');
    });

    it('should prioritize .code-workspace file match', () => {
        const result = WorkspaceMatcher.findBestMatch(
            mockWorkspaces,
            '/users/test/workspace',
            '/users/test/workspace/my.code-workspace'
        );
        expect(result?.id).toBe('ws3');
    });

    it('should perform fuzzy matching by basename if exact match fails', () => {
        // Simulating a case where drive letter might be different or path slightly off
        const result = WorkspaceMatcher.findBestMatch(mockWorkspaces, 'd:\\projects\\project-b');
        expect(result?.id).toBe('ws2');
    });

    it('should pick the most recently modified when multiple basenames match', () => {
        const multiWorkspaces: WorkspaceInfo[] = [
            { ...mockWorkspaces[0], id: 'old', lastModified: 1000, path: '/old/project-a' },
            { ...mockWorkspaces[0], id: 'new', lastModified: 5000, path: '/new/project-a' }
        ];
        const result = WorkspaceMatcher.findBestMatch(multiWorkspaces, '/any/path/project-a');
        expect(result?.id).toBe('new');
    });

    it('should return undefined when no match found', () => {
        const result = WorkspaceMatcher.findBestMatch(mockWorkspaces, '/random/path');
        expect(result).toBeUndefined();
    });
});
