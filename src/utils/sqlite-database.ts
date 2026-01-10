import { Logger } from './logger';

// Try to load the module, handle failure gracefully
let sqlite3: any;
try {
    sqlite3 = require('@vscode/sqlite3');
} catch (e) {
    Logger.error('[SqliteDatabase] Failed to require @vscode/sqlite3. Is it installed?', e);
    sqlite3 = null;
}

/**
 * A wrapper for SQLite operations to provide a Promise-based API
 * and ensure proper resource management.
 */
export class SqliteDatabase {
    private db: any;

    private constructor(db: any) {
        this.db = db;
    }

    /**
     * Opens a database connection.
     */
    static async open(dbPath: string): Promise<SqliteDatabase> {
        if (!sqlite3) {
            throw new Error('SQLite native driver not available');
        }

        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(new SqliteDatabase(db));
                }
            });
        });
    }

    /**
     * Executes a GET query and returns a single row.
     */
    async get(sql: string, params: any[] = []): Promise<any> {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err: any, row: any) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    /**
     * Iterates over query results.
     */
    async each(sql: string, params: any[], callback: (row: any) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.each(
                sql,
                params,
                (err: any, row: any) => {
                    if (err) {
                        Logger.error('[SqliteDatabase] Error reading row', err);
                        return;
                    }
                    callback(row);
                },
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    /**
     * Closes the database connection.
     */
    async close(): Promise<void> {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            this.db.close((err: any) => {
                if (err) reject(err);
                else {
                    this.db = null;
                    resolve();
                }
            });
        });
    }

    /**
     * Executes a block of code with an open database connection,
     * ensuring the connection is closed afterwards.
     */
    static async using<T>(dbPath: string, action: (db: SqliteDatabase) => Promise<T>): Promise<T> {
        const db = await SqliteDatabase.open(dbPath);
        try {
            return await action(db);
        } finally {
            await db.close();
        }
    }

    /**
     * static check if sqlite is available
     */
    static isAvailable(): boolean {
        return !!sqlite3;
    }
}
