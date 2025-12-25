import { BaseClineReader } from './base-cline-reader';

export class ClineReader extends BaseClineReader {
    constructor() {
        super({
            id: 'saoudrizwan.claude-dev',
            name: 'Cline'
        });
    }
}
