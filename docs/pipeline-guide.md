# Pipeline guide

What a pipeline is in EZPIPELINE, how to make one, and the handful of things
that behave differently from how they read.

For the field-by-field reference, see [Pipeline schema](pipeline-schema.md).
This page is the explanation; that page is the table.

---

## What a pipeline is

A pipeline is a **directory on the server** containing a YAML file that lists
shell commands. Running it means the server executes those commands, in order,
as child processes on its own machine, streaming the output to your browser.

That is the whole model, and it is worth being clear-eyed about what it
implies:

- There is no container per step, no isolation and no remote runner. Steps run
  as the same operating system user as EZPIPELINE, with the same access.
- Whoever can edit a pipeline's YAML can run arbitrary code on that host. This
  is why `editYaml` is treated as a privilege grant in
  [Permissions](permissions.md), not as a content permission.
- Anything a step installs, deletes or leaves behind stays on the host.

### The vocabulary

| Term | What it means |
|---|---|
| **Pipeline** | A directory with a YAML file. Identified by a UUID `id` |
| **Target** | The same thing, seen from the API. `target` in a request is a pipeline `id` or `appName` |
| **Step** | One shell command |
| **Workspace** | `workspace/` inside the pipeline directory. Where steps run by default |
| **Resources** | `resources/` inside it. Copied into the workspace before each run |
| **Group** | A folder above the pipeline. Organises the sidebar |
| **Build** | One execution, with a uuid, a number and a status |

---

## The directory

```
apps/server/data/pipelines/<Group>/<Name>/
  pipeline.yaml       preferred name; any *.yaml or *.yml is accepted
  .env                environment variables, found by name not by config
  .pipeline           empty marker: "this directory is a bundle"
  resources/          copied into workspace/ before each run
  workspace/          where steps execute
  versions/           <version>.zip artifacts, and .bak copies of the YAML
  build-history/      per-build metadata
```

Groups nest. `pipelines/FileFreak/Client/Staging` is the pipeline `Staging` in
group `FileFreak/Client`.

The loader prefers a file literally called `pipeline.yaml` and otherwise takes
the first `.yaml` or `.yml` in the directory. There is no
`config.ezpipeline.yaml` and no `.ezpipeline.yaml` extension, whatever older
documentation said.

---

## Creating one

### Through the UI

**New Pipeline** asks for a group and a name and scaffolds the directory: a
`pipeline.yaml` with a fresh UUID and one `echo` step, a `.env`, an empty
`resources/`, and the `.pipeline` marker. Edit the steps from there.

### By hand

```bash
mkdir -p apps/server/data/pipelines/Testing/my-app/resources
touch apps/server/data/pipelines/Testing/my-app/.pipeline
cat > apps/server/data/pipelines/Testing/my-app/pipeline.yaml <<'YAML'
id: 11111111-2222-3333-4444-555555555555
appName: my-app
version: 1.0.0
description: My first pipeline
steps:
  - name: Start
    shell: /bin/bash
    run: echo "Pipeline started"
YAML
```

Generate a real UUID; `id` must be unique because permissions and build
records key off it.

Then refresh targets in the UI, or restart the server.

---

## Steps

```yaml
steps:
  - name: Install
    shell: /bin/bash
    run: npm ci
    cwd: ./repo

  - name: Build
    shell: /bin/bash
    cwd: ./repo
    run: |
      echo "Building..."
      npm run build
    env:
      NODE_ENV: production
    continueOnError: false
```

Steps run in order and stop at the first failure unless
`continueOnError: true`.

### Each step is a fresh shell

`cd` does not carry between steps. This is the single most common surprise:

```yaml
# does not work
- name: Checkout
  run: cd repo && git checkout staging
- name: Verify
  run: git branch --show-current     # runs in workspace/, not workspace/repo
```

Chain within one step, or set `cwd`:

```yaml
- name: Verify
  run: git branch --show-current
  cwd: ./repo
```

### `cwd: root` is not the repository root

Relative `cwd` values are joined onto `workspace/`. The literal `root`
resolves to `apps/server`, the server application directory. If you wrote
`cwd: root` expecting your checkout, you are somewhere else entirely.

### Approval gates

```yaml
- name: Approve production deploy
  type: approval
```

The build pauses with status `paused` and waits for someone to release it.
Two caveats: the approve endpoint has no permission check, so any logged-in
user can release it; and the pause is not published on the SSE stream, so a UI
watching only that stream sees a build that has simply stopped moving.

---

## Environment variables

### Where they come from

Four sources, and only two of them are configured in the YAML.

**1. The pipeline's `.env`.** Found by name in the pipeline directory: `.env`,
or failing that `.env.<pipeline id>`.

> The `env:` field in your YAML has nothing to do with this. Every generated
> pipeline contains `env: .env` and the runtime never reads it. Renaming your
> file and updating `env:` will break the pipeline. See
> [Pipeline schema](pipeline-schema.md#env-does-not-do-what-it-says).

**2. The global environment**, at `apps/server/data/.env.global`, managed
under Settings and through `/api/global-env`. Loaded once at server start.

**3. Step-level `env`**, a map on the individual step.

**4. Injected by EZPIPELINE**: `WORKSPACE`, `RESOURCES`, `ENV_FILE`,
`PIPELINE_ID`, `PIPELINE_NAME`, `TARGET_NAME`, `BUILD_ID`, plus headless flags
like `CI=true` and `GIT_TERMINAL_PROMPT=0`.

### Precedence, and the part that surprises people

Later wins:

1. server process environment (which by now includes the pipeline `.env`)
2. `PATH`, with plugin binaries prepended
3. `WORKSPACE`, `RESOURCES`, `ENV_FILE`
4. **the step's own `env`**
5. **the injected identifiers and headless flags**

Group five is applied *after* your step's `env`, so you cannot override
`CI`, `TERM`, `BUILD_ID` or the git prompt suppressors from a step. The
headless flags are there deliberately: a command that stops to ask for a
password would otherwise hang the build indefinitely, since nothing is
attached to its stdin.

### One thing to be aware of

Loading a pipeline's `.env` assigns each key onto the **server's own**
`process.env`. The values therefore outlive the build and are visible to the
next pipeline that runs. If two pipelines both define `DEPLOY_KEY`, whichever
ran last wins until the server restarts. This is a bug in
`EZPipelineController.run()`, reported but not fixed by this documentation
pass. Until it is fixed, do not rely on a variable being absent just because
this pipeline does not define it.

### Interpolation

`${VAR}` is substituted by EZPIPELINE before the command reaches the shell.
Plain `$VAR` is left for the shell to expand, which usually amounts to the
same thing but is not the same mechanism.

```yaml
- name: Checkout
  run: git checkout ${BRANCH_NAME}
```

---

## Resources

Files in the pipeline's `resources/` directory are copied into
`workspace/resources` before the first step, and `${RESOURCES/filename}`
expands to the copied path.

```yaml
- name: Deploy
  run: scp -i ${RESOURCES/deploy_key} -r dist/ user@host:/var/www/
```

During the copy, any file ending `.pem` or `.key`, or named `id_rsa`, is
chmod'd to `600`. Without that, `ssh` refuses the key with a permissions
warning that reads like a network failure.

Resource files are gated by the `viewResources` permission when read through
`/api/config/content`. They are **not** gated in the artifact download route,
so anything a build zips up is readable by any logged-in user. See
[Permissions](permissions.md#where-nothing-is-checked).

---

## Versions and rollback

On success the workspace is archived to `versions/<version>.zip`, excluding
`node_modules` and `.git`. If the workspace contains a `Dockerfile`, an image
is built and tagged instead of a zip being made.

Old versions are pruned oldest-first once there are more than 10, or once the
directory exceeds 1 GB.

Rolling back unzips a chosen artifact into a clean `rollback_workspace` and
runs the pipeline against it. **Smart rollback** first rewrites the YAML to
drop steps that look like build steps, matching on the name or command
containing `build`, `compile`, `test`, `npm run build` or `docker build`. The
reasoning is that you already have the artifact and only want the deploy half.
The matching is textual, so a step called "Test connectivity" will be skipped
too. Check the plan at `GET /api/pipelines/:target/rollback-plan` before
committing to it.

---

## Kubernetes

Add a `kubernetes` block and it runs after the last step. The presence of the
block is the trigger; **there is no `enabled` flag**.

```yaml
kubernetes:
  namespace: production
  context: my-aks-cluster
  deploymentFile: k8s/deployment.yaml
  serviceFile: k8s/service.yaml
```

What actually happens: optionally `kubectl config use-context`, then
`kubectl apply -f` on the deployment file, then the service file if given.

What does **not** happen, despite earlier documentation saying so: it does not
wait for rollout, does not report deployment status, and does not fail the
build if `kubectl` fails. Errors are caught and logged. If you want the build
to depend on the rollout, do it as an ordinary step:

```yaml
- name: Wait for rollout
  run: kubectl rollout status deployment/my-app -n production --timeout=5m
```

See [Kubernetes](kubernetes.md).

---

## Scheduling

Schedules are cron expressions stored in the database, managed under a
pipeline's Schedule tab or through `/api/schedules`. A scheduled run does not
honour `requireConfirmation`, because that check lives in the browser.

Only admins can create schedules. Deleting or toggling one, however, is open
to any logged-in user, because of a duplicate route registration. See
[Permissions](permissions.md#where-nothing-is-checked).

---

## Worked examples

### Build and deploy a Node app

```yaml
id: 3f2a1b0c-9d8e-4c7b-a6f5-1e2d3c4b5a69
appName: web-app
version: 1.4.0
description: Build the web app and rsync it to staging
environment: staging
steps:
  - name: Clone
    shell: /bin/bash
    run: rm -rf repo && git clone -b ${BRANCH} ${REPO_URL} repo

  - name: Install
    shell: /bin/bash
    cwd: ./repo
    run: npm ci

  - name: Build
    shell: /bin/bash
    cwd: ./repo
    run: npm run build
    env:
      NODE_ENV: production

  - name: Deploy
    shell: /bin/bash
    cwd: ./repo
    run: rsync -avz -e "ssh -i ${RESOURCES/deploy_key}" dist/ ${DEPLOY_HOST}:/var/www/app/
```

`BRANCH`, `REPO_URL` and `DEPLOY_HOST` come from the pipeline's `.env`;
`deploy_key` sits in its `resources/`.

### Build, push, deploy with an approval gate

```yaml
id: 7c6b5a49-3e2d-4f1a-8b0c-9d8e7f6a5b40
appName: api-prod
version: 2.1.0
description: Build and push the API image, then deploy on approval
environment: prod
requireConfirmation: true
kubernetes:
  namespace: production
  deploymentFile: k8s/deployment.yaml
steps:
  - name: Build image
    shell: /bin/bash
    run: docker build -t ${REGISTRY}/api:${TAG} .

  - name: Push image
    shell: /bin/bash
    run: docker push ${REGISTRY}/api:${TAG}

  - name: Approve production deploy
    type: approval

  - name: Wait for rollout
    shell: /bin/bash
    run: kubectl rollout status deployment/api -n production --timeout=5m
```

The `kubernetes` block applies the manifest after the last step; the explicit
rollout step is what makes a failed deploy fail the build.

---

## When something is wrong

**The pipeline does not appear.** Check the YAML parses, check the directory
is under `data/pipelines`, check there is a `.yaml` in it, then refresh
targets or restart. Parse errors are logged to
`apps/server/logs/app.log`.

**A step fails and the error mentions a missing directory.** `cwd` is relative
to `workspace/`, and `workspace/` starts empty on a fresh pipeline. A step
that clones must run before a step that enters the clone.

**`${VAR}` came through literally.** The variable is not set. Add a debug step
running `env | sort` and look. Remember that `env:` in the YAML does not point
at your `.env` file.

**A command hangs forever.** It is waiting on stdin, which is not connected.
The git and apt suppressors cover the common cases; anything else needs its
own non-interactive flag.

More in [Troubleshooting](troubleshooting.md).

---

[Back to the documentation index](README.md)
