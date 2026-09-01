# Pipeline YAML schema

Every field of a `pipeline.yaml`, and whether the runtime actually reads it.

That last column matters more than usual here, because several fields that
look load-bearing are not. `env:` is the worst of them: it names your
environment file and the runtime ignores it completely. Details below.

---

## The file

A pipeline is a **directory**, not a file. The runtime looks in each
directory for `pipeline.yaml` by name; failing that it takes the first
`.yaml` or `.yml` file it finds there.

```
data/pipelines/<Group>/<Name>/
  pipeline.yaml       the config. Any *.yaml works, this name is preferred
  .env                environment variables, found by name
  .pipeline           empty marker file saying "this is a bundle"
  resources/          files copied into the workspace before a run
  workspace/          where steps execute
  versions/           build artifacts and YAML backups
  build-history/
```

There is no `.ezpipeline.yaml` extension and no `config.ezpipeline.yaml`.
Older documentation used both. Neither has ever been what the loader looks
for.

---

## Root fields

| Field | Type | Required | Read at runtime | Notes |
|---|---|---|---|---|
| `id` | string | yes | yes | UUID. The real identifier everywhere: permissions, API calls, build records |
| `appName` | string | yes | yes | Display name. Also accepted as a target in `POST /api/run-pipeline` |
| `version` | string | yes | yes | Names the build artifact, `<version>.zip` |
| `description` | string | yes | yes | Printed in the build log header |
| `steps` | `Step[]` | yes | yes | Executed in order |
| `group` | string | no | partly | See [group](#group) |
| `environment` | string | no | yes, by the UI | Tag such as `dev`, `prod`, `qa`. Colours the sidebar entry |
| `requireConfirmation` | boolean | no | **browser only** | See below |
| `kubernetes` | object | no | yes | See [kubernetes](#kubernetes) |
| `env` | string | no | **no** | See below. Present in every generated file, read by nothing |
| `author` | string | no | **no** | Written when a pipeline is created through the UI, never read back |

### `env` does not do what it says

Every generated pipeline carries `env: .env`, and every previous version of
the documentation said it pointed at the environment file.

It does not. `EZPipelineController.run()` never looks at `pipeline.env`. It
finds the file by convention, in the pipeline's own directory:

1. `.env`
2. failing that, `.env.<pipeline id>`

Setting `env: production.env` will not load `production.env`. To use a
different file, rename it to `.env`.

### `requireConfirmation` is not enforced by the server

Set it and the dashboard shows a confirmation dialog before running. The
`POST /api/run-pipeline` handler does not check the field, so anything
calling the API directly, including a schedule, runs without confirming. It
is a UI courtesy, not a gate.

### `group`

Grouping comes from the **directory layout** under `data/pipelines`, not
reliably from this field. A pipeline at `pipelines/FileFreak/Client/Staging`
reports its group as `FileFreak/Client`. A pipeline sitting directly at
`pipelines/Test` reports an empty group even when its YAML says
`group: Test`. Treat the field as a hint and the directory as the truth.

---

## Step fields

| Field | Type | Required | Read at runtime | Notes |
|---|---|---|---|---|
| `name` | string | yes | yes | Display name and the key for step timings |
| `run` | string | yes | yes | Shell command. Multi-line supported |
| `cwd` | string | no | yes | See [cwd](#cwd) |
| `shell` | string | no | yes | e.g. `/bin/bash`. Default is the system shell |
| `env` | map | no | yes | Step-only variables, but see [precedence](#environment-variable-precedence) |
| `continueOnError` | boolean | no | yes | Carry on if this step fails |
| `description` | string | no | yes | Shown in the UI |
| `type` | string | no | yes | Only `approval` is special |
| `timeoutSeconds` | number | no | **no** | Declared in `types/yaml`, never consulted |
| `retries` | number | no | **no** | Same |
| `condition` | string | no | **no** | Same |

`command` and `image` are not supported and never have been. If you have seen
them in an example, it was wrong.

### `cwd`

| Value | Resolves to |
|---|---|
| omitted | the pipeline's `workspace/` |
| a relative path | joined onto `workspace/` |
| `root` | **`apps/server`**, the server app directory |

That last one is a trap. `root` does not mean the repository root and does not
mean your checkout. It is `PROJECT_ROOT` in `EZPipelineController.ts`, which
resolves to `apps/server`.

Note also that `cd` inside a `run` does not carry to the next step. Each step
is a fresh shell. Chain with `&&` inside one step, or set `cwd` on each.

### `type: approval`

The build pauses, its status becomes `paused`, and it waits for
`POST /api/builds/:id/approve`. Steps before it are already done; steps after
it run on release.

Two things to know: the approve endpoint has **no permission check**, so
anyone logged in can release anyone's gate; and the internal `build_paused`
event is not forwarded to the SSE stream, so a UI watching only SSE cannot
see the build enter the waiting state.

---

## `kubernetes`

The presence of this block is what triggers deployment. **There is no
`enabled` flag**; if the key exists, it runs.

| Field | Type | Required | What it does |
|---|---|---|---|
| `namespace` | string | yes | Logged. Not passed to `kubectl` as `-n` |
| `deploymentFile` | string | yes | `kubectl apply -f <this>` |
| `context` | string | no | `kubectl config use-context <this>` first |
| `serviceFile` | string | no | A second `kubectl apply -f` |
| `imagePullSecret` | string | no | Declared, not used |
| `valuesFile` | string | no | Declared, not used |
| `helmChart` | string | no | Declared, not used |

The entire implementation is `deployToKubernetes()` in
`EZPipelineController.ts`: optionally switch context, then apply one or two
files. It does **not** wait for rollout, does **not** report deployment status,
and swallows any failure into a log line, so a failed `kubectl apply` does not
fail the build.

Fields named `enabled`, `deploymentName`, `imageName`, `imageTag` and
`configPath` appeared in older documentation. None of them exist.

See [Kubernetes](kubernetes.md).

---

## Environment variable precedence

For each step, from lowest priority to highest:

1. The server process environment, which by this point **includes the
   pipeline's `.env`**, because loading it assigns onto `process.env`
2. `PATH`, rewritten to prepend plugin binary directories
3. Injected paths: `WORKSPACE`, `RESOURCES`, `ENV_FILE`
4. The step's own `env` map
5. Injected identifiers and headless flags, which **override step `env`**

Step five is the surprise. These are applied last and cannot be overridden by
a step:

| Variable | Value |
|---|---|
| `PIPELINE_ID` | the pipeline's `id` |
| `PIPELINE_NAME` | its `appName` |
| `TARGET_NAME` | the id again, kept for older pipelines |
| `BUILD_ID` | this build's uuid |
| `CI` | `true` |
| `TERM` | `dumb` |
| `GIT_TERMINAL_PROMPT` | `0` |
| `GIT_ASKPASS` | `echo` |
| `GCM_INTERACTIVE` | `never` |
| `DEBIAN_FRONTEND` | `noninteractive` |

Setting `CI: "false"` in a step's `env` does nothing. The headless defaults
exist so a command that would otherwise sit waiting for a password prompt
fails fast instead of hanging the build forever.

---

## Interpolation

Use `${VAR}` in a `run` command. Plain `$VAR` is left to the shell, which
usually works but is not substituted by EZPIPELINE.

`${RESOURCES/filename}` is a special form that expands to a file inside the
copied resources directory.

### Injected paths

| Variable | Points at |
|---|---|
| `WORKSPACE` | the pipeline's workspace directory |
| `RESOURCES` | `workspace/resources`, after the copy |
| `ENV_FILE` | the `.env` that was loaded, if one was |

Resources are copied from the pipeline's `resources/` into the workspace
before the first step. During the copy, any `*.pem`, `*.key` or `id_rsa` is
chmod'd to `600`, because `ssh` and `scp` refuse to use a private key with
looser permissions and the resulting error is not obvious.

---

## Two competing type definitions

If you go looking in the source, you will find `EZPIPELINEYAML` declared
twice:

| File | Status |
|---|---|
| `apps/server/src/controllers/EZPipelineController.ts` | **The real one.** What the loader parses against |
| `apps/server/src/types/yaml/index.ts` | Stale. Nothing imports it except `KubernetesConfig` |

The stale one marks `docker` and `deployment` as **required** and adds
`testCriteria` and `coverage`. No pipeline sets any of them and no code reads
them. It also lacks `requireConfirmation`, `environment`, `type` and
`description`, which the runtime does support.

This page documents the controller's definition, because that is the one that
decides whether your file works.

---

## A complete example

```yaml
id: 2b5d8f3e-9a1c-4e7b-b2d6-3f8a5c9e1b56
appName: Test
version: 1.0.0
description: Test EZPipeline features with mock data
environment: development
group: Test

steps:
  - name: Environment Setup
    shell: /bin/bash
    run: |
      echo "Node version: $(node --version)"
      echo "Working directory: $(pwd)"

  - name: Build
    shell: /bin/bash
    cwd: ./repo
    run: npm ci && npm run build
    env:
      NODE_ENV: production

  - name: Approve deploy
    type: approval

  - name: Deploy
    shell: /bin/bash
    run: scp -i ${RESOURCES/deploy_key} -r dist/ user@host:/var/www/
```

An `approval` step needs no `run`. The loop returns before it would be used,
so anything you put there is ignored. The `Step` type marks `run` as required,
which is why editors will complain, but the runtime does not.

---

[Back to the documentation index](README.md)
