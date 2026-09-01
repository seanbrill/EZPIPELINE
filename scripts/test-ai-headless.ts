
import { io } from "socket.io-client";

const API_URL = "http://localhost:8080";

async function main() {
    console.log("🚀 Starting Headless AI Assistant Test...");

    // 1. Check Setup Status
    console.log("🔍 Checking Setup Status...");
    let res = await fetch(`${API_URL}/api/setup-status`);
    let data = await res.json();
    console.log("Status Response:", data);

    let token = "";

    // API returns { initialized: boolean }
    // initialized: false means we NEED setup.
    if (!data.initialized) {
        console.log("⚙️ System needs setup. Creating Admin user...");
        res = await fetch(`${API_URL}/api/setup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: "admin_test",
                password: "password123",
                confirmPassword: "password123"
            })
        });

        if (!res.ok) {
            console.error("❌ Setup failed:", await res.text());
            process.exit(1);
        }
        data = await res.json();
        token = data.token;
        console.log("✅ Admin created. Token acquired.");
    } else {
        console.log("🔒 System already setup. Logging in...");
        // Try logging in with test creds, otherwise fail (or use existing token if I had one)
        // Since we just reset, we expect to be in setup mode or have known creds.
        // If reset happen, it should be setup mode.
        // If manual test created admin, we might fail here unless we know creds.
        // I'll try generic admin/admin or admin_test/password123

        res = await fetch(`${API_URL}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "admin_test", password: "password123" })
        });

        if (!res.ok) {
            console.log("⚠️ Login failed with admin_test, trying admin/admin...");
            res = await fetch(`${API_URL}/api/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: "admin", password: "admin" })
            });
        }

        if (!res.ok) {
            console.error("❌ Login failed. Cannot proceed without token.");
            process.exit(1);
        }

        data = await res.json();
        token = data.token;
        console.log("✅ Logged in. Token acquired.");
    }

    // 2. Connect Socket
    console.log("🔌 Connecting to Socket.IO...");
    const socket = io(API_URL, {
        auth: { token }
    });

    socket.on("connect", async () => {
        console.log("✅ Socket connected!");

        // 2a. Check AI Status
        console.log("🔍 Checking AI Status...");
        const statusRes = await fetch(`${API_URL}/api/ai/status`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const status = await statusRes.json();

        if (!status.installed) {
            console.log("📦 Claude CLI not installed. Installing...");
            // Listen for install events
            socket.on("claude-output", (data) => {
                if (data.includes("Installing")) process.stdout.write(".");
            });

            const installRes = await fetch(`${API_URL}/api/ai/action`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    action: 'install',
                    socketId: socket.id
                })
            });

            // Wait for install success
            await new Promise(resolve => {
                socket.on("claude-success", (msg) => {
                    if (msg.includes("Install Complete")) {
                        console.log("\n✅ Installation Complete!");
                        resolve(true);
                    }
                });
            });
            // Give it a sec
            await new Promise(r => setTimeout(r, 2000));
        } else {
            console.log("✅ Claude CLI already installed.");
        }

        // 3. Spawn Agent
        console.log("🤖 Spawning Agent...");
        // We use the REST API to trigger spawn, just like frontend
        const spawnRes = await fetch(`${API_URL}/api/ai/action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'spawn',
                socketId: socket.id
            })
        });

        if (!spawnRes.ok) {
            console.error("❌ Spawn failed:", await spawnRes.text());
            process.exit(1);
        }
        console.log("✅ Spawn command sent.");
    });

    socket.on("claude-output", (data) => {
        // Strip ANSI for cleaner logs
        const clean = data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
        if (clean.trim()) console.log(`[🤖 Agent]: ${clean.trim()}`);
    });

    socket.on("claude-init-complete", async () => {
        console.log("✨ Initialization Complete Event Received!");

        // 4. Send Input
        console.log("💬 Sending 'hello'...");
        const inputRes = await fetch(`${API_URL}/api/ai/action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'input',
                input: 'hello',
                socketId: socket.id
            })
        });

        if (!inputRes.ok) {
            console.error("❌ Send input failed:", await inputRes.text());
        } else {
            console.log("✅ Input sent.");
        }
    });

    // Timeout safety
    setTimeout(() => {
        console.log("⏱️ Test timed out after 60s.");
        process.exit(0); // Exit clean to show logs
    }, 60000);
}

main().catch(err => console.error(err));
