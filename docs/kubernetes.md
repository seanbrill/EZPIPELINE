# Kubernetes

Two separate things live on this page. The first is what EZPIPELINE's
`kubernetes:` block does. The second is a cheat sheet of `az` and `kubectl`
commands for working with an AKS cluster by hand.

---

## What EZPIPELINE does with `kubernetes:`

The block becomes the pipeline's **last step**, named "Deploy to Kubernetes".
It runs like any other step: its output is in the run's log, it has a row in
the run's timeline, and if a command fails, the run fails.

```yaml
kubernetes:
  context: my-aks-cluster
  namespace: production
  deploymentFile: k8s/deployment.yaml
  serviceFile: k8s/service.yaml
  rollout: deployment/my-app
  timeout: 5m
```

That block runs, in the pipeline's workspace:

```bash
kubectl --context 'my-aks-cluster' --namespace 'production' apply -f 'k8s/deployment.yaml' &&
  kubectl --context 'my-aks-cluster' --namespace 'production' apply -f 'k8s/service.yaml' &&
  kubectl --context 'my-aks-cluster' --namespace 'production' rollout status 'deployment/my-app' --timeout=5m
```

The context is passed to each command, never switched with
`kubectl config use-context`, so a deploy cannot change which cluster
anything else on the machine talks to.

### The fields

| Field | Required | What it does |
|---|---|---|
| `deploymentFile` | yes | `kubectl apply -f`, relative to the workspace |
| `serviceFile` | no | A second `kubectl apply -f` |
| `context` | no | Passed as `--context` |
| `namespace` | no | Passed as `--namespace`. Without it, the manifests' own `metadata.namespace`, or the context's default |
| `rollout` | no | One resource or a list (`deployment/my-app`). Each is waited for with `kubectl rollout status`; the step fails if one does not become ready |
| `timeout` | no | How long each rollout may take: `5m` (the default), `90s`, `1h` |
| `enabled` | no | `false` keeps the block in the file without deploying |

Without `rollout`, the step passes as soon as the cluster accepts the
manifests, whether or not a pod ever starts. Name the deployments you care
about.

The editor flags any other field in the block (`helmChart`, `valuesFile`,
`imagePullSecret`) as one that does nothing. For Helm, run it in a step.

### Doing it in steps instead

The block is a shorthand. Anything more involved belongs in ordinary steps:

```yaml
steps:
  - name: Build and push
    shell: /bin/bash
    run: |
      docker build -t ${REGISTRY}/my-app:${TAG} .
      docker push ${REGISTRY}/my-app:${TAG}

  - name: Deploy
    shell: /bin/bash
    run: helm upgrade --install my-app ./chart -n production --wait --timeout 5m
```

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
