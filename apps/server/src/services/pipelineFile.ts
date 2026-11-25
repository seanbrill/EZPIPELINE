/**
 * What a pipeline file may say, and what is done with it as it is loaded.
 *
 * Every field listed here is read by something. A field that is not listed does
 * nothing, so the editor says so (fieldWarnings) instead of letting it look like
 * configuration. Fields that older versions wrote and nothing ever read (`env`,
 * `author`, `group`) are dropped as the file is loaded.
 */
import type { EZPIPELINEYAML, KubernetesConfig, Step } from "../controllers/EZPipelineController.js";

export const ROOT_FIELDS = new Set(["id", "appName", "version", "description", "steps", "environment", "requireConfirmation", "kubernetes"]);
export const STEP_FIELDS = new Set([
  "name", "run", "steps", "cwd", "env", "shell", "continueOnError", "description", "type",
  "actions", "confirm", "requirePriorSteps", "requireLatestBuild", "requireLatestBuildUntilStep",
]);
export const KUBERNETES_FIELDS = new Set(["enabled", "context", "namespace", "deploymentFile", "serviceFile", "rollout", "timeout"]);

/** Why a field does nothing, for the ones people actually write. */
const ROOT_WHY: Record<string, string> = {
  env: "env is not used: the .env in the pipeline's folder is read by name. Remove this line.",
  author: "author is not used. Remove this line.",
  group: "group is not used: a pipeline's group is the folder it is in. Remove this line, or move the pipeline.",
  docker: "docker is not a pipeline field. Build images in a step.",
  deployment: "deployment is not a pipeline field. Deploy in a step.",
  testCriteria: "testCriteria is not a pipeline field. Run tests in a step; a failing command fails the run.",
  coverage: "coverage is not a pipeline field. Check coverage in a step.",
};
const STEP_WHY: Record<string, string> = {
  timeoutSeconds: "timeoutSeconds is not supported. Wrap the command: timeout 300 <command>.",
  retries: "retries is not supported. Retry in the command, or use continueOnError.",
  condition: "condition is not supported. Test inside the command: [ \"$X\" = yes ] || exit 0.",
  command: "command is not a step field. Use run.",
  image: "image is not a step field. Steps run on the server: use docker run in run.",
};
const K8S_WHY: Record<string, string> = {
  imagePullSecret: "imagePullSecret is not supported. Put it in the manifest.",
  valuesFile: "valuesFile is not supported. Run helm in a step.",
  helmChart: "helmChart is not supported. Run helm in a step.",
};

/** The step a `kubernetes:` block adds to the end of the pipeline. */
export const KUBERNETES_STEP = "Deploy to Kubernetes";

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The `kubernetes:` block as an ordinary last step, so the deploy is in the run's
 * log and timeline, and a failed `kubectl apply` fails the run. The context and
 * namespace are passed to each command rather than switched globally, so the
 * deploy cannot change which cluster anything else on the machine talks to.
 */
export function kubernetesStep(k: KubernetesConfig | undefined, taken: string[] = []): Step | null {
  if (!k || typeof k !== "object" || k.enabled === false || typeof k.deploymentFile !== "string" || !k.deploymentFile.trim()) return null;
  const flags = [k.context ? `--context ${q(k.context)}` : "", k.namespace ? `--namespace ${q(k.namespace)}` : ""].filter(Boolean).join(" ");
  const apply = (f: string) => `kubectl ${flags ? flags + " " : ""}apply -f ${q(f)}`;
  // rollout: wait for these to be ready ("deployment/web"), so a deploy whose pods
  // never start fails the run instead of passing the moment the API accepts it.
  const rollouts = (Array.isArray(k.rollout) ? k.rollout : k.rollout ? [k.rollout] : []).filter((r): r is string => typeof r === "string" && !!r.trim());
  const timeout = /^\d+[smh]$/.test(String(k.timeout ?? "")) ? String(k.timeout) : "5m";
  const wait = (r: string) => `kubectl ${flags ? flags + " " : ""}rollout status ${q(r)} --timeout=${timeout}`;
  const run = [apply(k.deploymentFile), ...(k.serviceFile ? [apply(k.serviceFile)] : []), ...rollouts.map(wait)].join(" && \\\n  ");
  let name = KUBERNETES_STEP;
  for (let n = 2; taken.includes(name); n++) name = `${KUBERNETES_STEP} (${n})`;
  return { name, run, description: "From the pipeline's kubernetes block." };
}

/** The file as loaded: unread fields dropped, its group from its folder, the Kubernetes deploy as a step. */
export function normalizePipeline(parsed: EZPIPELINEYAML, where: { group?: string; filePath?: string }): EZPIPELINEYAML {
  const p = parsed as EZPIPELINEYAML & Record<string, unknown>;
  delete p.env;
  delete p.author;
  p.group = where.group ?? "";
  if (where.filePath !== undefined) p.filePath = where.filePath;
  if (Array.isArray(p.steps)) {
    const k8s = kubernetesStep(p.kubernetes, p.steps.map((s) => s?.name));
    if (k8s) p.steps = [...p.steps, k8s];
  }
  return parsed;
}

export interface FieldWarning { path: (string | number)[]; message: string }

/** Fields that do nothing, with where they are, for the editor. Not errors: the file still runs. */
export function fieldWarnings(js: Record<string, unknown>): FieldWarning[] {
  const out: FieldWarning[] = [];
  for (const k of Object.keys(js)) {
    if (!ROOT_FIELDS.has(k)) out.push({ path: [k], message: ROOT_WHY[k] ?? `${k} is not a pipeline field, so it does nothing.` });
  }
  const k8s = js.kubernetes;
  if (k8s && typeof k8s === "object" && !Array.isArray(k8s)) {
    for (const k of Object.keys(k8s)) {
      if (!KUBERNETES_FIELDS.has(k)) out.push({ path: ["kubernetes", k], message: K8S_WHY[k] ?? `kubernetes.${k} is not supported, so it does nothing.` });
    }
  }
  const walk = (steps: unknown, at: (string | number)[]) => {
    if (!Array.isArray(steps)) return;
    steps.forEach((s, i) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) return;
      for (const k of Object.keys(s)) {
        if (!STEP_FIELDS.has(k)) out.push({ path: [...at, i, k], message: STEP_WHY[k] ?? `${k} is not a step field, so it does nothing.` });
      }
      const st = s as Record<string, unknown>;
      if (st.cwd === "root") out.push({ path: [...at, i, "cwd"], message: "cwd: root is the server's own folder, which moves with every install. Use a path in the workspace." });
      walk(st.steps, [...at, i, "steps"]);
    });
  };
  walk(js.steps, ["steps"]);
  return out;
}
