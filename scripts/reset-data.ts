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
    Claude: args.includes('--claude'),
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

    console.log('\n🔧 No flags provided. Default Behavior: Deep Clean Everything (Preserve Pipeline Configs)');
    console.log('Use Smart Reset by default or choose specific option:\n');

    console.log('1. Smart Reset (Recommended)');
    console.log('   Runs: Users, DB, Plugins, Claude, Logs, Build History');
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
    console.log('7. Reset Claude Directory Only');
    console.log('8. Reset NPM Cache Only');
    console.log('9. Cancel');

    return new Promise((resolve) => {
        rl.question('\nSelect an option (default: 1): ', (answer) => {
            rl.close();
            const choice = answer.trim();
            const newFlags = { ...flags };

            // Default to 1
            if (choice === '' || choice === '1') {
                newFlags.SmartReset = true;
                // Enable sub-flags for clarity in execution
                newFlags.Users = true;
                newFlags.Plugins = true;
                newFlags.Claude = true;
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
                    case '7': newFlags.Claude = true; break;
                    case '8': newFlags.Cache = true; break;
                    case '9':
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
        console.log("🚀 No flags provided. Defaulting to Smart Reset...");
        console.log("   (Use 'npm run reset -- --menu' to see options)");

        flags.SmartReset = true;
        // Enable sub-flags
        flags.Users = true;
        flags.Plugins = true;
        flags.Claude = true;
        flags.Logs = true;
    }

    // Config paths
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const rootDir = path.resolve(__dirname, '..');
    const paths = {
        pipelines: path.join(rootDir, 'apps/server/data/pipelines'),
        plugins: path.join(rootDir, 'apps/server/data/plugins'),
        logs: path.join(rootDir, 'apps/server/logs'),
        sandbox: path.join(rootDir, 'apps/server/ai_sandbox'),
        db: path.join(rootDir, 'apps/server/data/app.db')
    };

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
                // Iterate through first level (Groups) or direct legacy folders
                // EZPipeline structure: data/pipelines/<Group>/<Target> OR data/pipelines/<Target> (Legacy)
                // We'll walk recursively-ish or just handle 2 levels.

                const processPipelineDir = (pDir: string) => {
                    const builds = path.join(pDir, 'builds');
                    const history = path.join(pDir, 'build-history');
                    // versions? If requested. User said "reset versions".
                    // Assuming versions are stored in 'versions' dir or tracked in DB.
                    // If file-based versions exist:
                    const versions = path.join(pDir, 'versions');

                    [builds, history, versions].forEach(d => {
                        if (fs.existsSync(d)) {
                            fs.rmSync(d, { recursive: true, force: true });
                            console.log(`   - Cleared ${path.basename(d)} in ${path.basename(pDir)}`);
                        }
                    });
                };

                const groups = fs.readdirSync(paths.pipelines);
                for (const group of groups) {
                    const groupPath = path.join(paths.pipelines, group);
                    if (fs.statSync(groupPath).isDirectory()) {
                        // Check if this IS a pipeline (Legacy) or a Group
                        // Heuristic: If it has 'workspace' or '.pipeline' it's a pipeline.
                        // Or if it contains subdirectories that are pipelines.
                        // Simpler: Just clean any 'builds'/'build-history' found in deep traversal? 
                        // Let's assume 2 levels max + legacy root.

                        processPipelineDir(groupPath); // Treat as pipeline (Legacy)

                        // Check children (Groups)
                        const children = fs.readdirSync(groupPath);
                        for (const child of children) {
                            const childPath = path.join(groupPath, child);
                            if (fs.statSync(childPath).isDirectory()) {
                                processPipelineDir(childPath);
                            }
                        }
                    }
                }
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

    // 5. Reset AI Sandbox (Claude)
    if (flags.everything || flags.Claude) {
        if (fs.existsSync(paths.sandbox)) {
            console.log('🤖 Resetting AI Sandbox...');
            try {
                fs.rmSync(paths.sandbox, { recursive: true, force: true });
                fs.mkdirSync(paths.sandbox);
                console.log('✅ AI Sandbox reset.');
            } catch (e) {
                console.error(`❌ Failed to reset sandbox: ${e}`);
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
