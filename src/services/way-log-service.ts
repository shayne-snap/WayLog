import { ConfigurationManager } from '../config/configuration';
import { Logger } from '../utils/logger';

export class WayLogService {
    private static instance: WayLogService;
    private configManager: ConfigurationManager;

    private constructor(configManager: ConfigurationManager) {
        this.configManager = configManager;
    }

    public static getInstance(configManager: ConfigurationManager): WayLogService {
        if (!WayLogService.instance) {
            WayLogService.instance = new WayLogService(configManager);
        }
        return WayLogService.instance;
    }

    public async initialize(): Promise<void> {
        if (!this.configManager.isEnabled) {
            Logger.info('WayLog is disabled, skipping initialization');
            return;
        }

        try {
            Logger.info('Initializing WayLog services...');
            // Local-first: No server connection needed
            Logger.info('WayLog initialized in local mode');
        } catch (error) {
            Logger.error('Failed to initialize WayLog service', error);
            throw error;
        }
    }

    public dispose() {
        // Cleanup resources
        Logger.info('WayLog service disposed');
    }
}
