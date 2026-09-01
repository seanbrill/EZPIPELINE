# Deployment

Running EZPIPELINE somewhere other than a laptop.

Before anything else, two settings decide whether your install is safe, and
neither of them warns you:

- **`JWT_SECRET` must be set.** Unset, login tokens are signed with a string
  committed to this repository, and anyone who knows it can mint an admin
  token. See [Configuration](configuration.md#jwt_secret).
- **`auth.required` must stay `true`** in `ezpipeline.config.json`. Set to
  `false`, the server accepts every request as a primary admin.

There is a third thing worth knowing before you expose this to a team: a
number of API routes do not check permissions, including build artifact
download and rollback. See
[Permissions](permissions.md#where-nothing-is-checked). Until those are fixed,
"can log in" is close to "can read everything and redeploy anything".

---

## What you are deploying

One Node process. It serves the API, the built client and the SPA fallback on
a single port, holds its data in one SQLite file, and runs pipeline steps as
its own child processes.

That last point shapes everything else. **Pipeline steps run as the EZPIPELINE
user, on the EZPIPELINE host, with no isolation.** Anyone who can edit a
pipeline's YAML can run code on that machine. Deploy it somewhere you would be
willing to give those people a shell.

---

## Route 1: Docker

The root `Dockerfile` builds the shipped image: Node 22 on Debian slim, client
compiled into the server's static directory, one process, one port, no data.

```bash
npm run build:dist          # or: docker build -t ezpipeline .
docker run -d --name ezpipeline \
  --env-file .env \
  -p 5000:5000 \
  -v ezpipeline_data:/app/apps/server/data \
  ezpipeline
```

The image listens on **5000** by default (`ENV PORT=5000`), and reads
`process.env.PORT` first, so you can move it.

### What the image contains, and why

| Choice | Reason |
|---|---|
| `node:22-bookworm-slim`, not `node:18-alpine` | `better-sqlite3` 12.5 has no prebuilt binary for Node 18 or for musl. On Debian glibc it downloads a prebuild and the image needs no compiler at all |
| `bash`, `git`, `unzip`, `python3`, `openssh-client` installed | The server shells out to all of them by hardcoded name: `TerminalService` spawns `/bin/bash`, rollback runs `unzip -o`, `services/bridge.py` needs `python3` |
| A pinned Docker CLI | For pipeline steps that build and push images, against the host's mounted socket |
| `tini` as PID 1 | So SIGTERM reaches Node and its children get cleaned up, instead of Docker killing the container ten seconds later with pipeline processes still running |

The compiled server is installed at `apps/server/src`, not
`apps/server/compile`. That looks odd and is deliberate: five modules compute
paths from `__dirname` plus a fixed number of `..` segments, and building into
`compile/` inserts one extra directory into every one of those counts. The
`Dockerfile` explains it at length at the point where it does it.

### Docker Compose

`docker-compose.yml` defines four services:

| Service | Profile | Port | What it is |
|---|---|---|---|
| `init` | default | | Prepares directories, proves `better-sqlite3` loads, exits |
| `server` | default | 5001 | Development server, source bind-mounted |
| `client` | default | 5000 | Vite dev server, source bind-mounted |
| `app` | `prod` | 5000 | The shipped image, no bind mount, no hot reload |

The default services are a **development** stack. For production:

```bash
docker compose --profile prod up --build app
```

Data lives in a named volume, `ezpipeline_data`, not a bind mount. SQLite file
locking over a bind mount, particularly on macOS, is a known source of
"database is locked" and of silent corruption. The trade-off is that a fresh
container starts with an empty database and walks you through first-run setup
once.

### `npm run build:local`

Builds an image with **your current `apps/server/data` baked in**, for demos
and bug reports. It contains `app.db` with password hashes and MFA secrets,
`data/.env.global`, and every per-pipeline `.env`. Do not push it anywhere.
See [Scripts](scripts.md#npm-run-buildlocal).

---

## Route 2: Node and PM2

### Build and transfer

```bash
rsync -avz --exclude node_modules --exclude apps/server/data \
  ./ user@server:/opt/ezpipeline/

ssh user@server
cd /opt/ezpipeline
npm install
npm run init
npm run build
```

No copy step after the build. `vite.config.ts` writes the client straight into
`apps/server/public`.

### Run it

```bash
npm install -g pm2
cd /opt/ezpipeline/apps/server
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`ecosystem.config.cjs` **already exists** in `apps/server`. Older
documentation told you to create one, with different contents and a different
process name, which would have given you two entries. What is actually there:

```javascript
module.exports = {
  apps: [{
    name: "EZPIPELINE",
    script: "compile/src/server.js",
    watch: ["compile", "yaml", "env"],
    watch_delay: 2000,
    ignore_watch: ["pipeline_workspace/PIPELINE_OUTPUT", "node_modules"],
  }],
};
```

Two things to fix before you rely on it:

- It runs `compile/src/server.js`, the unbundled `tsc` output, rather than
  `compile/index.js`, the esbuild bundle that `npm run start -w apps/server`
  uses. Both work; they are different artifacts and only one is what the build
  is for.
- `watch` is on. In production a file change restarts the process, and
  `yaml` and `env` are not directories that exist in this repository.

A production configuration:

```javascript
module.exports = {
  apps: [{
    name: "EZPIPELINE",
    script: "compile/index.js",
    cwd: "/opt/ezpipeline/apps/server",
    instances: 1,
    watch: false,
    autorestart: true,
    max_memory_restart: "1G",
    env: { NODE_ENV: "production", PORT: 5001 },
  }],
};
```

`instances: 1` is not negotiable. SQLite with `better-sqlite3` is one writer,
and the build state lives in memory in a singleton. PM2 cluster mode will
corrupt both.

---

## Reverse proxy

Three things have to work: ordinary HTTP, the **SSE** stream carrying build
progress, and the **WebSocket** carrying the assistant and terminal. They are
different mechanisms and a proxy config that handles one can silently break
another.

### Nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Build progress. SSE, not WebSocket.
    # Buffering must be off: with it on, nginx holds the stream until its
    # buffer fills, so build output arrives in bursts minutes late or not at
    # all, and the page looks frozen mid-build.
    location /api/logs-stream {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }

    # The AI assistant and the terminal. WebSocket.
    location /socket.io/ {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 24h;
    }
}
```

The `/api/logs-stream` block is the one people leave out, because SSE looks
like an ordinary GET until you notice it never finishes. Symptom: builds
appear to hang, then all their output arrives at once.

Note also that the plugin install endpoint,
`POST /api/plugins/:id/install`, streams chunked plain text and wants the same
buffering treatment if you use it.

### Apache

```apache
<VirtualHost *:443>
    ServerName your-domain.com

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/your-domain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/your-domain.com/privkey.pem

    ProxyPreserveHost On

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*) ws://localhost:5001/$1 [P,L]

    # SSE: no output buffering
    <Location /api/logs-stream>
        ProxyPass http://localhost:5001/api/logs-stream flushpackets=on
        SetEnv proxy-sendchunked 1
        SetEnv proxy-nokeepalive 0
    </Location>

    ProxyPass        / http://localhost:5001/
    ProxyPassReverse / http://localhost:5001/
</VirtualHost>
```

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite ssl
```

### TLS

```bash
sudo certbot --nginx -d your-domain.com
sudo certbot renew --dry-run
```

Socket.IO's CORS is configured `origin: "*"` in `server.ts`, with a comment
saying to fix it in production. It has not been fixed. Behind a proxy this
matters less because the browser is same-origin, but it is worth knowing.

---

## Monitoring

```bash
pm2 logs EZPIPELINE
pm2 monit
pm2 status
```

Application logs are at `apps/server/logs/app.log`, level `info`, not
configurable without editing `Logger.ts`. There is no rotation; add
`logrotate` or `pm2-logrotate`.

Health check:

```bash
curl -s https://your-domain.com/health
# {"status":"ok"}
```

`/health` already exists and is not under `/api`. It reports only that the
process is answering; it does not check the database.

---

## Backups

Back up two things.

**The database.** One file.

```bash
sqlite3 /opt/ezpipeline/apps/server/data/app.db \
  ".backup '/opt/backups/ezpipeline-$(date +%F-%H%M%S).db'"
```

Use `.backup` rather than `cp`. It is consistent against a live database;
`cp` can catch a partial write, and a `-wal` file you did not copy.

**The pipelines.**

```bash
tar -czf /opt/backups/pipelines-$(date +%F).tar.gz \
  --exclude='*/workspace' --exclude='*/versions' \
  /opt/ezpipeline/apps/server/data/pipelines/
```

Excluding `workspace` and `versions` is deliberate. Those are checkouts and
build artifacts, they are enormous, and they are reproducible. The YAML,
`.env` files and `resources` are what you cannot regenerate.

Daily:

```cron
0 2 * * * /opt/ezpipeline/scripts/backup-db.sh
```

That script does not exist yet. Write it, or inline the two commands above.

**Restore**: stop the process, copy the file back, start it. Migrations rerun
harmlessly on boot.

---

## Security checklist

- [ ] `JWT_SECRET` set to a long random value
- [ ] `auth.required` is `true`
- [ ] HTTPS, with HTTP redirected
- [ ] Firewall: only 80, 443 and SSH
- [ ] The EZPIPELINE user is not root and owns only what it needs
- [ ] `chmod 600 apps/server/data/app.db`
- [ ] Per-pipeline `.env` files are not world-readable
- [ ] `npm audit` clean, or knowingly not
- [ ] Backups running, and a restore actually tested
- [ ] You know `useTerminal` is a shell on the host, and `useClaude` is edit
      access to every pipeline's YAML and environment
- [ ] You have read [where permissions are not checked](permissions.md#where-nothing-is-checked)

Not on the list because it does not exist: rate limiting. There is none, on
`/api/login` or anywhere else. Put it in the proxy.

---

## Scaling

You cannot run two instances against one database. `better-sqlite3` is a
single writer, and build state lives in memory in a singleton in one process.
No PM2 cluster mode, no second node, no load balancer in front of two copies.

Getting past that means a real database, moving build state out of process
memory, and shared storage for the pipeline directories. None of that exists
today. Scale vertically.

---

[Back to the documentation index](README.md)
