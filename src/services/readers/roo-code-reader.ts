import { BaseClineReader } from './base-cline-reader';

export class RooCodeReader extends BaseClineReader {
    constructor() {
        super({
            id: 'rooveterinaryinc.roo-cline',
            name: 'Roo Code'
        });
    }
}
