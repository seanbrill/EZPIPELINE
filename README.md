# EZPIPELINE

A self-hosted CI/CD tool. You describe a pipeline in a YAML file, EZPIPELINE
runs the steps as shell commands on the machine hosting it, and streams the
output to a web interface as it happens.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

---

## What it is, and what that implies

There is no container per step, no remote runner and no queue. One Node
process owns everything: the database, the pipeline files, and the child
processes that run your steps.

That is the appeal, and it is also the thing to understand before you deploy
it. **Pipeline steps run as the EZPIPELINE user, on the EZPIPELINE host, with
no isolation.** Anyone who can edit a pipeline's YAML can run code on that
machine. Put it somewhere you would be willing to give those people a shell.

---

## What it does

- **Pipelines from YAML.** Steps run in order, with per-step working
  directory, shell, environment and error handling.
- **Live build output.** Progress and logs stream to the browser over
  Server-Sent Events while the build runs.
- **Per-pipeline permissions.** Seven independent flags, so "can deploy" and
  "can rewrite the deploy script" are separable.
- **Versioning and rollback.** Successful builds are archived; a rollback
  unzips one and re-runs the deploy half of the pipeline.
- **Approval gates.** A step can pause the build until someone releases it.
- **Scheduling.** Cron expressions per pipeline.
- **An AI assistant.** Talks to the Anthropic API and reaches your instance
  through eleven defined tools, with no shell and no filesystem access.
- **Plugins.** Directories whose binaries are added to the pipeline's `PATH`.
- **Kubernetes apply.** A `kubernetes:` block runs `kubectl apply` after the
  last step. Read [what it does and does not do](docs/kubernetes.md) first.
- **JWT authentication**, with optional email-code MFA.

### Not built

Listing this is more useful than a roadmap. None of the following exist:
automated tests, rate limiting, password reset by email, token refresh, SSO,
multi-node support, GitHub or GitLab integration, notifications, or a metrics
dashboard.

---

## Quick start

Node **20 or newer** is required. `better-sqlite3` has no prebuilt binary for
Node 18 and the failure looks like a Python error.

### With Docker

```bash
git clone <repository-url>
cd EZPIPELINE
node scripts/docker.mjs
```

Checks Docker is running, checks your ports agree, builds on first run, and
starts the stack. Server on 5001, client on 5000.

### Without Docker

```bash
git clone <repository-url>
cd EZPIPELINE
npm install
npm run init
cp .env.example .env      # then set JWT_SECRET
npm run start
```

Open **http://localhost:5000**, create the first admin user, and you are in.

> Note the client port. It is **5000**, from `ezpipeline.config.json`, not
> Vite's usual 5173.

### Set `JWT_SECRET` before anyone else uses it

```bash
JWT_SECRET=$(openssl rand -hex 32)
```

Unset, the server signs login tokens with a string committed to this
repository, and anyone who knows it can mint an admin token. Nothing warns
you.

---

## Documentation

**[Start at the documentation index](docs/README.md).**

Every page there was checked against the code in `apps/` and corrected where
the two disagreed. Several now say a feature is missing or unenforced where
they used to say it worked.

| | |
|---|---|
| [Setup and installation](docs/setup.md) | Get it running |
| [Pipeline guide](docs/pipeline-guide.md) | Build something that runs |
| [Pipeline schema](docs/pipeline-schema.md) | Every YAML field, and which ones are read |
| [Permissions](docs/permissions.md) | The seven flags, and where nothing is checked |
| [Authentication](docs/authentication.md) | Login, MFA, agent tokens |
| [Configuration](docs/configuration.md) | Real settings, and the ones that do nothing |
| [Architecture](docs/architecture.md) | How the pieces fit |
| [API reference](docs/api-reference.md) | Every route, with real response shapes |
| [AI assistant](docs/ai-assistant.md) | The eleven tools, and its actual boundaries |
| [Development](docs/development.md) | Contributing, and the conventions |
| [Deployment](docs/deployment.md) | Docker, PM2, reverse proxy, backups |
| [Kubernetes](docs/kubernetes.md) | The `kubernetes:` block, plus an AKS cheat sheet |
| [Scripts and commands](docs/scripts.md) | Every script, and which ones destroy data |
| [Troubleshooting](docs/troubleshooting.md) | Symptoms and fixes |

---

## Layout

```
EZPIPELINE/
  apps/
    client/           React 19 + Vite 7 + Tailwind 4
    server/           Express 5 + better-sqlite3 + Socket.IO
      src/            routes, controllers, services, migrations
      data/           app.db, pipelines, plugins
      logs/
      public/         the built client, served in production
  docs/
  scripts/
  ezpipeline.config.json
  Dockerfile          the shipped image
  docker-compose.yml  dev stack, plus a prod profile
```

The client builds **into `apps/server/public`**, not `apps/client/dist`. There
is no copy step.

---

## Stack

**Server**: Node 20+, Express 5, SQLite via better-sqlite3, Socket.IO,
JWT plus bcrypt, Winston, node-cron, the Anthropic SDK.

**Client**: React 19, Vite 7, TailwindCSS 4, React Router 7, xterm.js,
Lucide, Socket.IO client.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run start` | Server and client, watch mode |
| `npm run dev:server` / `npm run dev:client` | One half only |
| `npm run build` | Build both workspaces |
| `npm run reset` | **Deletes users, database, plugins, logs. No prompt** |
| `npm run package` / `npm run build:dist` | Build the Docker image |
| `npm run build:local` | Image with **your data baked in**. Contains secrets |
| `node scripts/docker.mjs` | Start the Docker stack |

`npm run reset` performs a Smart Reset immediately and asks nothing. Use
`npm run reset -- --menu` for options. See
[Scripts](docs/scripts.md#npm-run-reset).

---

## Configuration

`ezpipeline.config.json` at the root for ports, paths and the auth switch;
`.env` at the root for secrets. Copy `.env.example`.

```json
{
  "ports": { "client": 5000, "server": 5001 },
  "paths": { "data": "apps/server/data",
             "logs": "apps/server/logs",
             "sandbox": "apps/server/ai_sandbox" },
  "auth":  { "required": true }
}
```

`paths.data` moves pipelines and plugins but **not** the database, which is
hardcoded to `apps/server/data/app.db`. Setting `auth.required` to `false`
disables authentication and authorization together, for everyone.

Full details, including the settings that are read by nothing, in
[Configuration](docs/configuration.md).

---

## Contributing

See [Development](docs/development.md) for the loop, the layout and the
conventions. In short: `.js` on relative imports, errors as a snake_case code
**with** a human message, never an empty array to signal failure, comments
that say why and what was rejected, and no em dashes anywhere.

If you change an API route, update
[the API reference](docs/api-reference.md) in the same commit.

---

## License

Apache 2.0. See [LICENSE](LICENSE).
