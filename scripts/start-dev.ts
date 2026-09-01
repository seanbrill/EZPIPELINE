import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// Read config
const CONFIG_PATH = path.resolve(__dirname, '../ezpipeline.config.json');
let config = {
    ports: {
        server: 5001,
        client: 5173
    }
};

try {
    if (fs.existsSync(CONFIG_PATH)) {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
} catch (e) {
    console.warn("Could not read ezpipeline.config.json, using defaults");
}

const SERVER_PORT = config.ports.server;
const CLIENT_PORT = config.ports.client;

function killPort(port: number) {
    try {
        // quiet check first
        execSync(`lsof -i:${port}`, { stdio: 'ignore' });
        console.log(`🔌 Killing process on port ${port}...`);
        execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
        console.log(`✅ Port ${port} cleared.`);
    } catch (e) {
        // Port not in use, do nothing
    }
}

async function main() {
    // Kill both ports
    killPort(SERVER_PORT);
    killPort(CLIENT_PORT);

    // Start concurrent servers
    console.log('🚀 Starting development servers...');

    // Server command with PORT env
    const serverCmd = `PORT=${config.ports.server} npm run dev:server`;

    // Client command 
    const clientCmd = `npm run dev:client`;

    const child = spawn('npx', [
        'concurrently',
        `"${serverCmd}"`,
        `"${clientCmd}"`,
        '--kill-others',
        '--prefix-colors',
        'blue,green'
    ], {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env }
    });

    child.on('exit', (code) => {
        process.exit(code || 0);
    });
}

main();
