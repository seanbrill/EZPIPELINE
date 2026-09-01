# Kubernetes

Two separate things live on this page. The first is what EZPIPELINE's
`kubernetes:` block actually does, which is less than it sounds. The second is
a cheat sheet of `az` and `kubectl` commands for working with an AKS cluster
by hand, which is what most people came here for.

---

## What EZPIPELINE does with `kubernetes:`

Add the block to a pipeline's YAML and it runs **after the last step**:

```yaml
kubernetes:
  namespace: production
  context: my-aks-cluster
  deploymentFile: k8s/deployment.yaml
  serviceFile: k8s/service.yaml
```

The whole implementation is `deployToKubernetes()` in
`apps/server/src/controllers/EZPipelineController.ts`, and it is short enough
to describe exactly:

1. If `context` is set, run `kubectl config use-context <context>`.
2. Run `kubectl apply -f <deploymentFile>`.
3. If `serviceFile` is set, run `kubectl apply -f <serviceFile>`.
4. Catch any error, log it, and carry on.

### The fields

| Field | Required | What it does |
|---|---|---|
| `namespace` | yes | **Logged only.** It is not passed to `kubectl` as `-n` |
| `deploymentFile` | yes | `kubectl apply -f` |
| `context` | no | `kubectl config use-context` first |
| `serviceFile` | no | A second `kubectl apply -f` |
| `imagePullSecret` | no | Declared in the type. Not used |
| `valuesFile` | no | Declared in the type. Not used |
| `helmChart` | no | Declared in the type. Not used |

`namespace` deserves the emphasis. It is written to the build log and never
reaches `kubectl`, so your manifests must carry their own
`metadata.namespace` or the apply lands in whatever namespace the current
context defaults to.

### Three things it does not do

Earlier documentation said it did all three.

**There is no `enabled` flag.** The presence of the `kubernetes` key is the
trigger. Setting `enabled: false` does nothing; the field is not read and the
deploy runs anyway. To turn it off, remove the block.

**It does not wait for rollout.** `kubectl apply` returns as soon as the API
server accepts the manifest. The build is marked successful at that moment,
whether or not a single pod ever became ready.

**It does not fail the build.** Every error is caught and turned into a log
line. A `kubectl` that is missing, unauthenticated or pointed at a dead
cluster produces a green build and a message in
`apps/server/logs/app.log`.

Fields named `deploymentName`, `imageName`, `imageTag` and `configPath` have
never existed.

### What to do instead

Treat the block as a convenience for the apply, and put anything you want the
build to depend on into ordinary steps, where a non-zero exit fails the
pipeline:

```yaml
steps:
  - name: Build and push
    shell: /bin/bash
    run: |
      docker build -t ${REGISTRY}/my-app:${TAG} .
      docker push ${REGISTRY}/my-app:${TAG}

  - name: Apply manifests
    shell: /bin/bash
    run: kubectl apply -n production -f k8s/

  - name: Wait for rollout
    shell: /bin/bash
    run: kubectl rollout status deployment/my-app -n production --timeout=5m
```

That version fails when the deploy fails, applies into the namespace you named,
and needs no `kubernetes:` block at all.

### Making kubectl available

Pipeline steps run as the EZPIPELINE server's user, so `kubectl` has to be on
that user's `PATH` and its kubeconfig has to be readable by that user. Two
routes:

- Install `kubectl` on the host and log in as the service user once, so
  `~/.kube/config` exists for it.
- Ship it as a plugin. `PluginManager` prepends plugin binary directories to
  the `PATH` given to steps, which is how the azure-cli plugin in this repo
  makes `az` available without a system-wide install.

In Docker, `kubectl` is **not** in the shipped image. The image installs
`bash`, `git`, `unzip`, `python3`, `openssh-client` and a Docker CLI, and
nothing else. Add it in your own layer or as a plugin.

### Credentials

Put a kubeconfig in the pipeline's `resources/` and point `KUBECONFIG` at it:

```yaml
steps:
  - name: Deploy
    shell: /bin/bash
    run: |
      export KUBECONFIG=${RESOURCES/kubeconfig}
      kubectl apply -n production -f k8s/
```

Values loaded from the pipeline's `.env` are redacted from build logs. A
kubeconfig sitting in `resources/` is **not**, because redaction only covers
env values. Anything a step prints from that file appears in the log in full.

---

## AKS cheat sheet

Not EZPIPELINE-specific. Ordinary Azure and Kubernetes commands, kept here
because this is where people look for them.

### Sign in and pick a subscription

```bash
az login
az account set --subscription "SUB_ID_OR_NAME"
az account show -o table
```

### Find and connect to a cluster

```bash
az aks list -o table
az aks get-credentials --resource-group <RG> --name <CLUSTER>
```

`get-credentials` merges the cluster into your existing kubeconfig and
switches to it. Add `--file ./kubeconfig` to write a standalone file instead,
which is what you want for a file you are going to put in a pipeline's
`resources/`.

### Contexts

```bash
kubectl config get-contexts
kubectl config current-context
kubectl config use-context <CONTEXT>
```

Getting this wrong is the classic way to deploy to the wrong cluster. In a
pipeline, prefer an explicit `--context` or a dedicated `KUBECONFIG` over
relying on whatever the current context happens to be.

### Look around

```bash
kubectl cluster-info
kubectl get nodes -o wide
kubectl get all -n <NAMESPACE>
kubectl get pods -A
kubectl describe pod <POD> -n <NAMESPACE>
```

### Logs

```bash
kubectl logs <POD> -n <NAMESPACE>
kubectl logs <POD> -n <NAMESPACE> --follow
kubectl logs <POD> -n <NAMESPACE> --previous     # the container before it crashed
```

`--previous` is the one that tells you why a `CrashLoopBackOff` is looping.

### Rollout

```bash
kubectl rollout status deployment/<NAME> -n <NAMESPACE> --timeout=5m
kubectl rollout history deployment/<NAME> -n <NAMESPACE>
kubectl rollout undo deployment/<NAME> -n <NAMESPACE>
```

`rollout status` is the command that makes a CI step honest: it exits non-zero
when the rollout fails or times out.

### Port forward

```bash
kubectl port-forward svc/<SERVICE> 8080:80 -n <NAMESPACE>
```

### Cleanup

```bash
kubectl delete pod <POD> -n <NAMESPACE>          # a Deployment will recreate it
kubectl delete deployment <NAME> -n <NAMESPACE>  # this one does not come back
```

---

[Back to the documentation index](README.md)
