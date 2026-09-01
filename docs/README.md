# EZPIPELINE documentation

Everything about how EZPIPELINE is built, run and changed.

EZPIPELINE is a self-hosted CI/CD tool. You describe a pipeline in a YAML
file, it runs the steps as shell commands on the machine hosting it, and
streams the output to a web interface as it happens.

Want to RUN it? Start with [Setup and installation](setup.md). It takes about
five minutes and ends with the app on your machine.

Want to know what a pipeline IS? [Pipeline guide](pipeline-guide.md) explains
the model before the syntax.

---

## What you can trust on these pages

Every claim here was checked against the code in `apps/` before it was
written. Where the docs and the code disagreed, the code won and the doc was
corrected.

That means some pages now say a feature is missing, partial or unenforced
where they used to say it worked. Those are not regressions in the product.
They are the docs catching up with it. Each one is called out in place, so
you can tell "not built" from "built and undocumented".

If a page describes something you cannot find, treat it as a bug in the page
and not in your understanding.

---

## Table of contents

### Getting it running

| Page | What it covers |
|---|---|
| [Setup and installation](setup.md) | Prerequisites, install, first admin user, how to tell it worked |
| [Configuration](configuration.md) | `ezpipeline.config.json`, the environment variables that are actually read, and the ones that do nothing |
| [Scripts and commands](scripts.md) | Every npm script, what it does, and which ones destroy data without asking |

### Using it

| Page | What it covers |
|---|---|
| [Pipeline guide](pipeline-guide.md) | What a pipeline is, how to create one, how steps run, where environment variables come from |
| [Pipeline schema](pipeline-schema.md) | Every field of `pipeline.yaml`, marked by whether the runtime reads it |
| [Permissions and access control](permissions.md) | The seven permission flags, what each one gates, and the routes where nothing is gated at all |
| [Authentication](authentication.md) | Login, JWT, MFA over email, agent tokens, and the real database schema |
| [AI assistant](ai-assistant.md) | Setting it up, its eleven tools, and an honest account of what it can reach |

### How it works

| Page | What it covers |
|---|---|
| [Architecture](architecture.md) | The pieces, how a build actually flows, and why progress arrives over SSE and not WebSocket |
| [API reference](api-reference.md) | Every route the server registers, grouped, with real response shapes |
| [Development](development.md) | Running it locally, project layout, adding an endpoint, adding a migration |

### Operations

| Page | What it covers |
|---|---|
| [Deployment](deployment.md) | Docker, PM2, reverse proxy, backups |
| [Kubernetes](kubernetes.md) | What the `kubernetes:` block in a pipeline really does, plus an AKS command cheat sheet |
| [Troubleshooting](troubleshooting.md) | Symptoms, causes and fixes, with the correct file and column names |

---

## Reading order, if you are new

1. [Setup and installation](setup.md) - get it running.
2. [Pipeline guide](pipeline-guide.md) - build something that runs.
3. [Permissions](permissions.md) - before you let anyone else in.
4. [Architecture](architecture.md) - when you want to change it.

---

## Two things worth knowing before you read anything else

**The database is at `apps/server/data/app.db`.** Older pages called it
`ezpipeline.db`. No such file has ever existed. If you followed a doc that
named it, none of your `sqlite3` commands did anything.

**Build progress is Server-Sent Events, not WebSocket.** Socket.IO is present
and is used, but only for the AI assistant and the interactive terminal.
Build starts, step progress and completion all arrive on
`GET /api/logs-stream`. See [Architecture](architecture.md#how-progress-reaches-the-browser).

---

## Recently changed

Two reworks landed while this documentation was being written, and the pages
covering them were rewritten against the new code rather than the old:

- **The AI assistant moved off the Claude Code CLI onto the Anthropic API.**
  It now has eleven tools, no shell and no filesystem access.
  [AI assistant](ai-assistant.md) covers the new arrangement and explains what
  the old one actually was, because the old page promised a sandbox that was
  not enforced.
- **The Docker setup was reworked.** New root `Dockerfile`, a compose stack
  with an init step, and `scripts/docker.mjs` as the entry point.
  [Setup](setup.md) and [Deployment](deployment.md) describe what is there
  now.

Two loose ends from those reworks, both outside this documentation's control:

- The npm aliases `docker:up`, `docker:down`, `docker:logs` and `docker:reset`
  are referred to in the Docker files but are not in `package.json` yet. Use
  `node scripts/docker.mjs` until they are.
- `package-lock.json` does not include `@anthropic-ai/sdk`. Run `npm install`
  and commit the lock file.

---

[Back to the project README](../README.md)
