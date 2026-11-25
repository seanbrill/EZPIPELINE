import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import readline from 'readline';

// Parse arguments
const args = process.argv.slice(2);
let flags = {
    everything: args.includes('--everything'),
    Pipelines: args.includes('--pipelines'),
    Plugins: args.includes('--plugins'), // Added Plugins
    Logs: args.includes('--logs'),
    Users: args.includes('--users'), // Database
    Cache: args.includes('--cache'),
    SmartReset: args.includes('--smart') || false, // Explicit flag or internal
    Menu: args.includes('--menu') || args.includes('-m')
};



// ... (rest of main)

// Helper update to promptUser
async function promptUser(): Promise<typeof flags> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('\n🔧 What should be reset? Nothing happens until you choose.\n');

    console.log('1. Smart Reset');
    console.log('   Runs: Users, DB, Plugins, Logs, Build History');
    console.log('   Preserves: Pipeline Configs (YAML, Resources, ENV)');
    console.log('');
    console.log('2. Factory Reset (NUKE EVERYTHING)');
    console.log('   WARNING: Deletes ALL Pipelines, Configs, Data, Logs, etc.');
    console.log('');
    console.log('--- Granular Options ---');
    console.log('3. Reset Pipelines Only');
    console.log('4. Reset Logs Only');
    console.log('5. Reset Users/Database Only');
    console.log('6. Reset Plugins Only');
    console.log('7. Reset NPM Cache Only');
    console.log('8. Cancel');

    return new Promise((resolve) => {
        rl.question('\nSelect an option (Enter cancels): ', (answer) => {
            rl.close();
            const choice = answer.trim();
            const newFlags = { ...flags };

            // Enter cancels: this deletes accounts, so it takes a choice.
            if (choice === '1') {
                newFlags.SmartReset = true;
                // Enable sub-flags for clarity in execution
                newFlags.Users = true;
                newFlags.Plugins = true;
                newFlags.Logs = true;
            } else {
                switch (choice) {
                    case '2':
                        newFlags.everything = true;
                        newFlags.Cache = true;
                        break;
                    case '3': newFlags.Pipelines = true; break;
                    case '4': newFlags.Logs = true; break;
                    case '5': newFlags.Users = true; break;
                    case '6': newFlags.Plugins = true; break;
                    case '7': newFlags.Cache = true; break;
                    case '8':
                    default:
                        console.log('❌ Cancelled.');
                        process.exit(0);
                }
            }
            resolve(newFlags);
        });
    });
}

// Main execution wrapper
(async () => {

    if (flags.Menu) {
        flags = await promptUser();
    } else if (args.length === 0) {
        // No flags used to mean a Smart Reset, which deletes every account,
        // with no question asked. Now it asks, and without a terminal to ask
        // in it does nothing.
        if (!process.stdin.isTTY) {
            console.log("Nothing was reset. Say what to reset, for example:");
            console.log("   npm run reset -- --smart      users, database, plugins, logs, build history");
            console.log("   npm run reset -- --logs");
            console.log("   npm run reset -- --menu");
            process.exit(1);
        }
        flags = await promptUser();
    } else if (flags.SmartReset) {
        flags.Users = true;
        flags.Plugins = true;
        flags.Logs = true;
    }

    // Config paths
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const rootDir = path.resolve(__dirname, '..');
    // The same folders the server uses: EZP_DATA_DIR / EZP_LOGS_DIR, else
    // paths.data / paths.logs in ezpipeline.config.json.
    let configured: { data?: string; logs?: string } = {};
    try { configured = JSON.parse(fs.readFileSync(path.join(rootDir, 'ezpipeline.config.json'), 'utf8')).paths ?? {}; } catch { /* defaults */ }
    const dataDir = path.resolve(rootDir, process.env.EZP_DATA_DIR || configured.data || 'apps/server/data');
    const logsDir = path.resolve(rootDir, process.env.EZP_LOGS_DIR || configured.logs || 'apps/server/logs');
    const paths = {
        pipelines: path.join(dataDir, 'pipelines'),
        plugins: path.join(dataDir, 'plugins'),
        logs: logsDir,
        db: path.join(dataDir, 'app.db')
    };
    console.log(`📁 Data: ${dataDir}`);

    console.log('🗑️  Starting Reset...');

    // 1. Reset Pipelines (Factory Nuke)
    if (flags.everything || flags.Pipelines) {
        if (fs.existsSync(paths.pipelines)) {
            console.log('📦 Clearing ALL Pipelines (Factory Reset)...');
            try {
                fs.rmSync(paths.pipelines, { recursive: true, force: true });
                fs.mkdirSync(path.join(paths.pipelines, 'General'), { recursive: true });
                console.log('✅ Pipelines reset.');
            } catch (e) {
                console.error(`❌ Failed to reset pipelines: ${e}`);
            }
        }
    }

    // 2. Smart Reset (Pipelines History Only)
    // Runs if SmartReset is true AND Pipelines/Everything is FALSE
    if (flags.SmartReset) {
        if (fs.existsSync(paths.pipelines)) {
            console.log('🧹 Smart Cleaning Pipelines (Builds & History)...');
            try {
                // Every folder holding a pipeline.yaml, at any depth: groups nest.
                const walk = (dir: string) => {
                    if (fs.existsSync(path.join(dir, 'pipeline.yaml'))) {
                        for (const name of ['builds', 'build-history', 'versions']) {
                            const d = path.join(dir, name);
                            if (fs.existsSync(d)) {
                                fs.rmSync(d, { recursive: true, force: true });
                                console.log(`   - Cleared ${name} in ${path.relative(paths.pipelines, dir)}`);
                            }
                        }
                    }
                    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                        // A pipeline's own working folders hold no pipelines.
                        if (e.isDirectory() && !['workspace', 'resources', 'builds', 'build-history', 'versions'].includes(e.name)) {
                            walk(path.join(dir, e.name));
                        }
                    }
                };
                walk(paths.pipelines);
                console.log('✅ Pipeline History Reset.');
            } catch (e) {
                console.error(`❌ Failed to smart clean pipelines: ${e}`);
            }
        }
    }

    // 3. Reset Plugins
    if (flags.everything || flags.Plugins) {
        if (fs.existsSync(paths.plugins)) {
            console.log('🔌 Clearing Plugins...');
            try {
                fs.rmSync(paths.plugins, { recursive: true, force: true });
                fs.mkdirSync(paths.plugins, { recursive: true });
                console.log('✅ Plugins reset.');
            } catch (e) {
                console.error(`❌ Failed to reset plugins: ${e}`);
            }
        }
    }

    // 4. Reset Logs
    if (flags.everything || flags.Logs) {
        if (fs.existsSync(paths.logs)) {
            console.log('📜 Clearing Logs...');
            try {
                const files = fs.readdirSync(paths.logs);
                for (const file of files) {
                    if (file !== '.gitkeep') {
                        fs.unlinkSync(path.join(paths.logs, file));
                    }
                }
                console.log('✅ Logs cleared.');
            } catch (e) {
                // ignore
            }
        }
    }


    // 6. Reset Users (Database)
    if (flags.everything || flags.Users) {
        if (fs.existsSync(paths.db)) {
            console.log('👥 Resetting Users & Database...');
            try {
                fs.unlinkSync(paths.db);
                console.log('✅ Database deleted.');
            } catch (e) {
                console.error(`❌ Failed to delete DB: ${e}`);
            }
        }
    }

    // 7. Reset NPM Cache
    if (flags.Cache) {
        console.log('🧹 Clearing NPM Cache (force)...');
        try {
            execSync('npm cache clean --force', { stdio: 'inherit' });
            console.log('✅ NPM Cache cleared.');
        } catch (e) {
            console.warn('⚠️  Failed to clear NPM cache (might need sudo).');
        }
    }

    // 8. Force Server Restart (Touch server.ts)
    console.log('🔄 Triggering Server Restart...');
    const serverPath = path.join(rootDir, 'apps/server/src/server.ts');
    if (fs.existsSync(serverPath)) {
        try {
            const time = new Date();
            fs.utimesSync(serverPath, time, time);
            console.log('✅ Server restart triggered.');
        } catch (e) {
            console.error(`⚠️  Failed to touch server.ts: ${e}`);
        }
    }

    console.log('\n✨ Reset complete. Server should restart automatically.');
})();
