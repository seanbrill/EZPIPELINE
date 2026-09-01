import { DatabaseService } from "./Database.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

export interface AgentToken {
    id: number;
    name: string;
    scopes: string[]; // e.g. ["yaml:read", "yaml:write"]
    created_at: string;
    last_used_at?: string;
}

export class AgentService {
    private static instance: AgentService;
    private db = DatabaseService.getInstance().getDb();

    private constructor() { }

    public static getInstance(): AgentService {
        if (!AgentService.instance) {
            AgentService.instance = new AgentService();
        }
        return AgentService.instance;
    }

    /**
     * Creates a new agent token. 
     * Returns the raw token (only shown once) and the created token record (without hash).
     */
    public async createToken(name: string, scopes: string[] = ["yaml:read", "yaml:write"]): Promise<{ token: string, record: AgentToken }> {
        // Generate a secure random token
        const rawToken = "ezp_" + crypto.randomBytes(32).toString("hex");

        // Hash it for storage
        const tokenHash = await bcrypt.hash(rawToken, 10);

        const stmt = this.db.prepare("INSERT INTO agent_tokens (name, token_hash, scopes) VALUES (?, ?, ?)");
        const result = stmt.run(name, tokenHash, JSON.stringify(scopes));

        return {
            token: rawToken,
            record: {
                id: result.lastInsertRowid as number,
                name,
                scopes,
                created_at: new Date().toISOString()
            }
        };
    }

    public listTokens(): AgentToken[] {
        const stmt = this.db.prepare("SELECT id, name, scopes, created_at, last_used_at FROM agent_tokens ORDER BY created_at DESC");
        const rows = stmt.all() as any[];
        return rows.map(row => ({
            ...row,
            scopes: JSON.parse(row.scopes)
        }));
    }

    public deleteToken(id: number) {
        const stmt = this.db.prepare("DELETE FROM agent_tokens WHERE id = ?");
        stmt.run(id);
    }

    public async validateToken(rawToken: string, requiredScope?: string): Promise<boolean> {
        // rawToken format: ezp_...
        // We need to find the token. Since we hash it, we can't look it up directly by hash easily 
        // unless we iterate (slow) or if we store a portion of it as ID/Prefix.
        // Optimization: In real world, we'd store a 'prefix' column or 'token_id' to lookup the hash.
        // For simplicity here (low volume of agents), we will iterate. 
        // OR better: store the token as `id.secret`. Let's assume the user just pastes the token.
        // To avoid iteration, let's just accept iteration for < 100 tokens. 

        const stmt = this.db.prepare("SELECT id, token_hash, scopes FROM agent_tokens");
        const tokens = stmt.all() as any[];

        for (const record of tokens) {
            const match = await bcrypt.compare(rawToken, record.token_hash);
            if (match) {
                // Check scope
                const scopes = JSON.parse(record.scopes) as string[];
                if (requiredScope && !scopes.includes(requiredScope)) {
                    return false;
                }

                // Update last used
                this.db.prepare("UPDATE agent_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(record.id);
                return true;
            }
        }
        return false;
    }
}
