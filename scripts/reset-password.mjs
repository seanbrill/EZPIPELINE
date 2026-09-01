#!/usr/bin/env node
// Get back into EZPIPELINE when nobody knows the password.
//
// There is no "forgot password" flow in this app - no reset endpoint, no mail
// out. For a self-hosted tool that is a reasonable choice, but it means a lost
// admin password locks the whole instance, and the only way back in used to be
// hand-editing SQLite inside a container. This is that, supported.
//
//   node scripts/reset-password.mjs --list
//   node scripts/reset-password.mjs <username> <new-password>
//
// The database lives in the `ezpipeline_data` Docker volume, so the work runs
// INSIDE the server container, where both the file and bcrypt already are.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = "/app/apps/server/data/app.db";

function fail(message) {
    console.error(`\n  ${message}\n`);
    process.exit(1);
}

/** Runs a snippet of node inside the server container. */
function inContainer(script) {
    const result = spawnSync(
        "docker",
        ["compose", "exec", "-T", "server", "node", "-e", script],
        { cwd: root, encoding: "utf8" }
    );
    if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-3).join("\n");
        fail(
            `Could not reach the server container.\n  Is the stack running? Try: npm run docker:up\n\n  ${detail}`
        );
    }
    return result.stdout.trim();
}

const [target, password] = process.argv.slice(2);

if (!target || target === "--help" || target === "-h") {
    console.log(`
  Reset an EZPIPELINE password.

    node scripts/reset-password.mjs --list
    node scripts/reset-password.mjs <username> <new-password>

  The stack must be running (npm run docker:up).
`);
    process.exit(target ? 0 : 1);
}

if (target === "--list") {
    // Names and roles only. This never prints a hash.
    const out = inContainer(`
        const Database = require('better-sqlite3');
        const db = new Database(${JSON.stringify(DB)}, { readonly: true });
        const rows = db.prepare('select id, username, email, is_admin from users order by id').all();
        if (!rows.length) {
            console.log('NO ACCOUNTS. Open the app and it will offer first-run setup.');
        } else {
            for (const r of rows) {
                console.log(\`  \${String(r.id).padStart(3)}  \${r.username}\${r.is_admin ? '  (admin)' : ''}  \${r.email ?? ''}\`);
            }
        }
    `);
    console.log(`\n  Accounts:\n${out}\n`);
    process.exit(0);
}

if (!password) fail(`Give the new password too:\n  node scripts/reset-password.mjs ${target} <new-password>`);
if (password.length < 8) fail("Choose a password of at least 8 characters.");

// The password is passed as a JSON string literal into the container script, so
// quotes and shell metacharacters in it are data, never code.
const out = inContainer(`
    const Database = require('better-sqlite3');
    const bcrypt = require('bcrypt');
    const db = new Database(${JSON.stringify(DB)});
    const user = db.prepare('select id, username from users where username = ?').get(${JSON.stringify(target)});
    if (!user) {
        const all = db.prepare('select username from users').all().map(u => u.username);
        console.log('NOTFOUND:' + JSON.stringify(all));
    } else {
        // Cost 10, matching routes/index.ts, so the new hash is
        // indistinguishable from one the app itself would write.
        const hash = bcrypt.hashSync(${JSON.stringify(password)}, 10);
        db.prepare('update users set password = ? where id = ?').run(hash, user.id);
        console.log('OK:' + user.username);
    }
`);

if (out.startsWith("NOTFOUND:")) {
    const names = JSON.parse(out.slice("NOTFOUND:".length));
    fail(
        names.length
            ? `There is no account called "${target}". These exist:\n  ${names.join("\n  ")}`
            : `There are no accounts at all. Open the app and it will offer first-run setup.`
    );
}

console.log(`
  Password updated for "${out.slice("OK:".length)}".
  Sign in at the client URL that npm run docker:up prints.
`);
