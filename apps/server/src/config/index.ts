import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv'; // Load dotenv

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to root ezpipeline.config.json
// apps/server/src/config -> ../../../..
const ROOT_DIR = path.resolve(__dirname, '../../../../');
const CONFIG_PATH = path.join(ROOT_DIR, 'ezpipeline.config.json');

// Load config
let config = {
    ports: { server: 5001, client: 5173 },
    paths: {
        data: 'apps/server/data',
        logs: 'apps/server/logs',
        sandbox: 'apps/server/ai_sandbox'
    },
    auth: {
        required: true,
        defaultUser: {
            username: "admin",
            isAdmin: true
        }
    },
    email: {
        enabled: false,
        host: "",
        port: 587,
        secure: false,
        from: "",
        auth: {
            user: "",
            pass: ""
        }
    }
};

try {
    if (fs.existsSync(CONFIG_PATH)) {
        const rawConfig = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const userConfig = JSON.parse(rawConfig);
        // Deep merge or simple override (simple for now)
        config = {
            ...config,
            ...userConfig,
            auth: { ...config.auth, ...userConfig.auth },
            email: { ...config.email, ...userConfig.email }
        };
    } else {
        console.warn(`Config file not found at ${CONFIG_PATH}, using defaults.`);
    }
} catch (error) {
    console.error(`Error loading config from ${CONFIG_PATH}:`, error);
}

// Configure dotenv to load from root .env
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

export const PORT = process.env.PORT || config.ports.server;
export const CLIENT_PORT = config.ports.client;
export const AUTH_CONFIG = config.auth;

export const EMAIL_CONFIG = {
    enabled: process.env.SMTP_ENABLED === 'true' || config.email.enabled,
    host: process.env.SMTP_HOST || config.email.host,
    port: parseInt(process.env.SMTP_PORT || '') || config.email.port,
    secure: process.env.SMTP_SECURE === 'true' || config.email.secure,
    from: process.env.SMTP_FROM || config.email.from,
    auth: {
        user: process.env.SMTP_USER || config.email.auth.user,
        pass: process.env.SMTP_PASS || config.email.auth.pass
    }
};

// Resolve paths relative to ROOT if they are relative paths
const resolvePath = (p: string) => path.isAbsolute(p) ? p : path.resolve(ROOT_DIR, p);

export const LOGS_DIR = resolvePath(config.paths.logs);
export const DATA_DIR = resolvePath(config.paths.data);
export const DB_PATH = path.join(DATA_DIR, 'app.db');
export const PIPELINES_DIR = path.join(DATA_DIR, 'pipelines');
export const SANDBOX_DIR = resolvePath(config.paths.sandbox);
export const DOCS_DIR = resolvePath(path.join(ROOT_DIR, 'docs'));
export const PUBLIC_DIR = path.resolve(__dirname, '../../public'); // Kept as build output

