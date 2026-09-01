import { DatabaseService } from "./Database.js";

export class SettingsService {
    private static instance: SettingsService;

    private constructor() { }

    public static getInstance(): SettingsService {
        if (!SettingsService.instance) {
            SettingsService.instance = new SettingsService();
        }
        return SettingsService.instance;
    }

    public get(key: string): string | null {
        const db = DatabaseService.getInstance().getDb();
        const stmt = db.prepare("SELECT value FROM settings WHERE key = ?");
        const row = stmt.get(key) as { value: string } | undefined;
        return row ? row.value : null;
    }

    public set(key: string, value: string): void {
        const db = DatabaseService.getInstance().getDb();
        const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
        stmt.run(key, value);
    }

    public getMultiple(keys: string[]): Record<string, string | null> {
        const result: Record<string, string | null> = {};
        keys.forEach(k => {
            result[k] = this.get(k);
        });
        return result;
    }
}
