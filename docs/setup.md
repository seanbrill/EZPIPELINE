# Setup and installation

Getting EZPIPELINE running on your machine. Two routes: Docker, which is the
short one, and a direct Node install, which is what you want if you are going
to change the code.

Either way you end up at a setup page, create the first admin user, and land on
an empty dashboard.

---

## Before you start

| | Version | Why |
|---|---|---|
| Node.js | **20 or newer** | `better-sqlite3` 12.5 declares `20.x \|\| 22.x \|\| 23.x \|\| 24.x \|\| 25.x`. On Node 18 there is no prebuilt binary and the install falls back to compiling from source |
| npm | 9+ | Workspaces |
| Git | any | |
| Docker | optional | For the container route |

Older documentation said Node 18. That is no longer true and the failure is
not obvious: npm falls back to `node-gyp` and you get a Python error rather
than anything mentioning Node versions.

```bash
node --version   # v20 or newer
npm --version
```

---

## Route 1: Docker

```bash
git clone <repository-url>
cd EZPIPELINE
node scripts/docker.mjs
```

That one command checks Docker is installed **and** that the daemon is
actually responding, checks that your ports agree with each other, builds the
images on first run, and starts the stack.

| Command | What it does |
|---|---|
| `node scripts/docker.mjs` | Start it. First run builds the images |
| `node scripts/docker.mjs down` | Stop it |
| `node scripts/docker.mjs logs` | Follow the logs |
| `node scripts/docker.mjs rebuild` | Rebuild images from scratch |
| `node scripts/docker.mjs reset` | Rebuild, and delete the data volume |

The stack is three services: `init` prepares the writable directories and
proves `better-sqlite3` loads before anything else starts, then `server` on
5001 and `client` on 5000.

Source is bind-mounted, so editing a file on your machine reloads the service
inside the container.

### One thing that will surprise you

The container starts with an **empty database**, not the one in
`apps/server/data` on your host. `apps/server/data` is a named Docker volume,
deliberately, because SQLite file locking over a macOS bind mount is a known
source of "database is locked" and of silent corruption, and because a
container and a host server should not be sharing one database file.

So you will do the first-run setup once inside the container. Your host data is
untouched. If you would rather share it and accept the risk, swap the volume
line in `docker-compose.yml` for a bind mount; the file says exactly where.

### Ports must agree

`scripts/docker.mjs` refuses to start if `SERVER_PORT` in `.env` disagrees with
`ports.server` in `ezpipeline.config.json`, and it is right to. The dev client's
API URL is compiled into the browser bundle from the config file, so a mismatch
gives you a healthy-looking stack where every request fails in the browser
console and nothing anywhere reports why.

---

## Route 2: Node directly

```bash
git clone <repository-url>
cd EZPIPELINE
npm install
npm run init
npm run start
```

`npm run init` runs `npm install` at the root and then `npm install -ws` for
both workspaces.

`npm run start` kills whatever is listening on the two configured ports, then
runs the server under `tsx watch` and the client under Vite, side by side
through `concurrently`.

You should see:

```
Server running at http://localhost:5001
```

and Vite opening a browser at **http://localhost:5000**.

Note the client port. The shipped `ezpipeline.config.json` sets it to `5000`,
not Vite's usual 5173. Older documentation said 5173 throughout; if a link in
an old page does not load, try 5000.

---

## Configure it

Copy the example env file and set at least one value:

```bash
cp .env.example .env
```

```bash
JWT_SECRET=<a long random string>
```

Generate one with `openssl rand -hex 32`.

**This is not optional in any install that matters.** Without it the server
signs login tokens with a fallback string that is committed to this
repository, and anyone who knows it can mint an admin token. Nothing warns
you. See [Configuration](configuration.md#jwt_secret).

Two more you may want now:

```bash
ANTHROPIC_API_KEY=sk-ant-...    # enables the AI assistant
SMTP_ENABLED=true               # plus the SMTP_* block, for email and MFA
```

Everything in `.env` is read once at startup, so restart the server after
editing it.

---

## Create the first user

1. Open the client, at **http://localhost:5000** by default.
2. You are redirected to `/setup`.
3. Enter a username and password. An email address is optional here but you
   will need one later if you turn on MFA enforcement.
4. Submit.

You are logged in immediately.

The account you just made is the **primary admin**. That is stronger than an
ordinary admin: no one, including other admins, can delete or demote it. It
exists so an instance cannot lock itself out.

This page only works while the `users` table is empty. Afterwards it redirects
to login.

---

## Check it worked

```bash
# The server is up
curl -s localhost:5001/health
# {"status":"ok"}

# Setup has been completed
curl -s localhost:5001/api/setup-status
# {"initialized":true}

# The database exists
ls -la apps/server/data/app.db

# Logs are being written
tail -f apps/server/logs/app.log
```

The database file is **`app.db`**. There is no `ezpipeline.db` and there never
has been, whatever earlier pages said. If you have been running `sqlite3` against
that name you have been creating an empty file each time.

To see inside it:

```bash
sqlite3 apps/server/data/app.db ".tables"
# agent_tokens  build_logs  builds  permissions  schedules  settings  user_devices  users
```

---

## What to do next

1. **Make a pipeline.** [Pipeline guide](pipeline-guide.md) walks through it.
2. **Read the permissions model** before adding anyone else.
   [Permissions](permissions.md), including the section on where nothing is
   checked.
3. **Set up email** if you want MFA or invitations. Settings, then SMTP, with a
   test button.

---

## When installation goes wrong

### The port is in use

`npm run start` clears both configured ports before starting, so this usually
means something else. To do it by hand:

```bash
lsof -ti:5001 | xargs kill -9
lsof -ti:5000 | xargs kill -9
```

Or change the numbers in `ezpipeline.config.json`. Change them there, not in
`.env` alone, because the client bundle reads the config file at build time.

### `npm install` fails building better-sqlite3

Almost always Node 18. Check with `node --version` and upgrade to 20 or newer.
The error will mention `node-gyp` or Python rather than Node, which is what
makes it hard to place.

If you are on a supported Node version:

```bash
npm cache clean --force
rm -rf node_modules apps/*/node_modules package-lock.json
npm install
npm run init
```

### `npm ci` complains that the lock file does not match

At the time of writing, `package-lock.json` at the root is missing packages
that `apps/server/package.json` asks for, including `@anthropic-ai/sdk`. The
Docker build works around it with a loud fallback to `npm install`, printing a
warning that the resulting image is not reproducible.

The fix is one command on the host, and then commit the result:

```bash
npm install
git add package-lock.json
```

### The client loads but every request fails

Open the browser console. If you see connection refused against a port
nothing is listening on, `.env` and `ezpipeline.config.json` disagree about
the server port. Make them match.

### Setup page redirects to login

A user already exists. Log in, or wipe the data:

```bash
npm run reset -- --menu
```

Choose **Reset Users/Database Only**. Note the `--` before `--menu`;
without it, `npm run reset` starts a Smart Reset immediately and asks
nothing. See [Scripts](scripts.md#npm-run-reset).

---

[Back to the documentation index](README.md)
