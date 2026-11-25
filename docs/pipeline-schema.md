# Pipeline YAML schema

Every field of a `pipeline.yaml`. Each one listed here is read; anything else
in the file does nothing, and the editor flags it.

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

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | UUID. The real identifier everywhere: permissions, API calls, build records |
| `appName` | string | yes | Display name. Also accepted as a target in `POST /api/run-pipeline` |
| `version` | string | yes | The pipeline's own version, shown with it |
| `description` | string | yes | Printed in the build log header |
| `steps` | `Step[]` | yes | Executed in order |
| `environment` | string | no | Tag such as `dev`, `prod`, `qa`. Colours the sidebar entry |
| `requireConfirmation` | boolean | no | Every run must be confirmed. See below |
| `kubernetes` | object | no | Adds a last step. See [kubernetes](#kubernetes) |

Those are all the fields. Anything else in the file does nothing, and the
editor's Problems panel says so with an amber warning on its line. The file
still saves: a warning is not an error.

### The environment file

The pipeline's variables are in the `.env` in its own folder, found by name
(failing that, `.env.<pipeline id>`). There is no field for it. Older
pipelines may carry `env: .env`; the editor flags the line, and removing it
changes nothing.

### Its group is its folder

A pipeline at `pipelines/FileFreak/Client/Staging` is in the group
`FileFreak/Client`. There is no `group:` field: to change a pipeline's group,
move the pipeline.

### `requireConfirmation`

Every run must be confirmed. The app asks first, wherever the run is started
(the pipeline's page, the run page, the ⌘K palette). A run started through the
API has to send `"confirmed": true`, or `POST /api/run-pipeline` answers
`409 confirmation_required`. Schedules and git watches are set up by someone
allowed to run the pipeline, and run without asking.

---

## Step fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Display name and the key for step timings |
| `run` | string | yes, or `steps` | Shell command. Multi-line supported |
| `steps` | list | instead of `run` | Substeps, run in order. See [substeps](#substeps) |
| `cwd` | string | no | See [cwd](#cwd) |
| `shell` | string | no | e.g. `/bin/bash`. Default is the system shell |
| `env` | map | no | Step-only variables, but see [precedence](#environment-variable-precedence) |
| `continueOnError` | boolean | no | Carry on if this step fails |
| `description` | string | no | Shown in the UI |
| `type` | string | no | `approval` (a gate) or `action` (a button on the run) |

There is no `timeoutSeconds`, `retries`, `condition`, `command` or `image`.
The editor flags each one and says what to do instead: `timeout 300 <command>`
for a time limit, a loop in the command for retries, a test at the top of the
command for a condition.

### `cwd`

| Value | Resolves to |
|---|---|
| omitted | the pipeline's `workspace/` |
| a relative path | joined onto `workspace/` |
| `root` | the server's own folder |

Avoid `root`. It does not mean the repository root or your checkout: it is the
server's own folder, which is somewhere different in every install (inside the
app, in the desktop app). The editor warns about it. Use a path in the
workspace.

Note also that `cd` inside a `run` does not carry to the next step. Each step
is a fresh shell. Chain with `&&` inside one step, or set `cwd` on each.

### `type: approval`

The build pauses, its status becomes `paused`, and it waits for
`POST /api/builds/:id/approve`. Steps before it are already done; steps after
it run on release.

Releasing a gate needs `run` permission on the pipeline. A gate can be
released once: a second approve answers 409. The `build_paused` and
`build_approved` events are on the SSE stream.

A gate is only allowed at the top level, and cannot have substeps.

### Substeps

A step can be made of smaller steps. Give it `steps:` instead of `run:`; the
children run in order, in the parent's `cwd`, `shell` and `env` unless they set
their own, and can nest up to six levels. A failing child stops its parent
unless it has `continueOnError`.

```yaml
- name: Build and push the images
  shell: /bin/bash
  steps:
    - name: api image
      run: docker build -t api . && docker push api
    - name: worker image
      steps:
        - name: Build the image
          run: docker build -t worker ./worker
        - name: Push to the registry
          run: docker push worker
```

A command can report substeps of its own by printing markers. Marker lines are
not shown in the log.

| Line | Meaning |
|---|---|
| `::ezp step <name>` | Open a substep. Inside an open one, it is a child of it |
| `::ezp done` | Close the innermost open substep as passed |
| `::ezp fail [message]` | Close it as failed |
| `::ezp progress <n>/<m> [unit]` | Set a counter on the innermost open substep, or on the step itself |

Substeps the command leaves open close when it ends: passed if it exited 0,
failed if not. On the run page, a tile with substeps opens into them, and the
log follows: each line belongs to the substep that was open when it was
printed.

A pipeline whose steps are the wrong shape (both `run` and `steps`, neither,
a gate inside substeps) is refused when it is saved.

### Rerunning from a step

`POST /api/run-pipeline` with `fromStep: "<step name>"` starts a new run at
that step. The steps before it are marked skipped and the workspace is kept as
the last run left it.

---

## `kubernetes`

The block becomes the pipeline's last step, "Deploy to Kubernetes", with its
output in the run's log. If `kubectl` fails, the run fails.

| Field | Type | Required | What it does |
|---|---|---|---|
| `deploymentFile` | string | yes | `kubectl apply -f`, relative to the workspace |
| `serviceFile` | string | no | A second `kubectl apply -f` |
| `context` | string | no | Passed as `--context` |
| `namespace` | string | no | Passed as `--namespace` |
| `rollout` | string or list | no | Waited for with `kubectl rollout status`; the step fails if one does not become ready |
| `timeout` | string | no | Per rollout: `5m` (the default), `90s`, `1h` |
| `enabled` | boolean | no | `false` keeps the block without deploying |

See [Kubernetes](kubernetes.md).

---

## Environment variable precedence

For each step, from lowest priority to highest:

1. The server's own environment, with `PATH` led by the plugins' folders
2. Instance-wide variables (`.env.global`)
3. Each group's `.env.group`, outermost group first
4. The pipeline's `.env`
5. Injected paths: `WORKSPACE`, `RESOURCES`, `ENV_FILE`
6. A rollback's variables (`EZP_ROLLBACK`, `EZP_IMAGE_TAG` and the rest)
7. The step's own `env` map
8. Injected identifiers and headless flags, which **override step `env`**

The layers are put together for each run and never written into the
server's own environment, so a variable reaches only the pipeline it belongs
to.

These are applied last and cannot be overridden by a step:

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

## Where this is defined

`EZPIPELINEYAML`, `Step` and `KubernetesConfig` in
`apps/server/src/controllers/EZPipelineController.ts`. The list of fields the
editor accepts, and what it says about the rest, is in
`apps/server/src/services/pipelineFile.ts`.

---

## A complete example

```yaml
id: 2b5d8f3e-9a1c-4e7b-b2d6-3f8a5c9e1b56
appName: Test
version: 1.0.0
description: Test EZPipeline features with mock data
environment: development

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
