import { BaseClineReader } from './base-cline-reader';

export class KiloCodeReader extends BaseClineReader {
    constructor() {
        super({
            id: 'kilocode.kilo-code',
            name: 'Kilo Code'
        });
    }
}
