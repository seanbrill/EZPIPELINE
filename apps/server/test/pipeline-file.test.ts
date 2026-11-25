// What a pipeline file may say: unread fields dropped on load and flagged in the
// editor, the kubernetes block as a real last step, and the sign-in limiter.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "yaml";
import { fieldWarnings, kubernetesStep, normalizePipeline, KUBERNETES_STEP } from "../src/services/pipelineFile.js";
import { checkPipelineYaml } from "../src/services/substeps.js";
import { createLoginLimiter } from "../src/services/loginLimiter.js";

describe("normalizePipeline", () => {
  test("drops env and author, and takes the group from the folder", () => {
    const p = normalizePipeline({ id: "a", appName: "A", version: "1", description: "", steps: [{ name: "x", run: "true" }], env: ".env", author: "sb", group: "Wrong" } as any, { group: "Right/Inner", filePath: "/p/a.yaml" });
    assert.equal((p as any).env, undefined);
    assert.equal((p as any).author, undefined);
    assert.equal(p.group, "Right/Inner");
    assert.equal(p.filePath, "/p/a.yaml");
  });

  test("a kubernetes block becomes the last step", () => {
    const p = normalizePipeline({ id: "a", appName: "A", version: "1", description: "", steps: [{ name: "Build", run: "make" }], kubernetes: { namespace: "web", deploymentFile: "k8s/deploy.yaml" } } as any, { group: "" });
    assert.equal(p.steps.length, 2);
    assert.equal(p.steps[1].name, KUBERNETES_STEP);
    assert.equal(p.steps[1].run, "kubectl --namespace 'web' apply -f 'k8s/deploy.yaml'");
  });
});

describe("kubernetesStep", () => {
  test("context and namespace go on each command; both files are applied", () => {
    const s = kubernetesStep({ context: "prod", namespace: "web", deploymentFile: "d.yaml", serviceFile: "s.yaml" })!;
    assert.equal(s.run, "kubectl --context 'prod' --namespace 'web' apply -f 'd.yaml' && \\\n  kubectl --context 'prod' --namespace 'web' apply -f 's.yaml'");
    assert.ok(!s.run.includes("use-context"), "never switches the machine's context");
  });

  test("rollout waits for each named resource, and fails the step if it does not become ready", () => {
    const s = kubernetesStep({ namespace: "web", deploymentFile: "d.yaml", rollout: ["deployment/api", "deployment/worker"], timeout: "90s" })!;
    assert.equal(s.run, "kubectl --namespace 'web' apply -f 'd.yaml' && \\\n  kubectl --namespace 'web' rollout status 'deployment/api' --timeout=90s && \\\n  kubectl --namespace 'web' rollout status 'deployment/worker' --timeout=90s");
    assert.match(kubernetesStep({ deploymentFile: "d.yaml", rollout: "deployment/x", timeout: "; rm -rf /" })!.run, /--timeout=5m$/);
  });

  test("enabled: false, or no deploymentFile, adds nothing", () => {
    assert.equal(kubernetesStep({ enabled: false, deploymentFile: "d.yaml" }), null);
    assert.equal(kubernetesStep({ namespace: "web" } as any), null);
    assert.equal(kubernetesStep(undefined), null);
  });

  test("quotes what it is given, and does not take a step's name", () => {
    const s = kubernetesStep({ deploymentFile: "it's.yaml" }, [KUBERNETES_STEP])!;
    assert.equal(s.run, "kubectl apply -f 'it'\\''s.yaml'");
    assert.equal(s.name, `${KUBERNETES_STEP} (2)`);
  });
});

describe("fieldWarnings", () => {
  test("names each field that does nothing, with why", () => {
    const w = fieldWarnings({
      id: "a", appName: "A", env: ".env", author: "x", group: "g",
      kubernetes: { deploymentFile: "d", helmChart: "c" },
      steps: [{ name: "a", run: "x", timeoutSeconds: 5, steps: [{ name: "b", run: "y", retries: 2 }] }, { name: "c", run: "z", cwd: "root" }],
    });
    const at = w.map((x) => x.path.join("."));
    assert.deepEqual(at, ["env", "author", "group", "kubernetes.helmChart", "steps.0.timeoutSeconds", "steps.0.steps.0.retries", "steps.1.cwd"]);
    assert.match(w[0].message, /\.env in the pipeline's folder/);
  });

  test("a file using only real fields has none", () => {
    assert.deepEqual(fieldWarnings({ id: "a", appName: "A", version: "1", description: "d", environment: "prod", requireConfirmation: true, steps: [{ name: "Gate", type: "approval" }, { name: "Go", type: "action", actions: [], confirm: true }] }), []);
  });
});

describe("checkPipelineYaml warnings", () => {
  test("a field that does nothing is a warning on its own line, not an error", () => {
    const src = "id: a\nappName: A\nenv: .env\nsteps:\n  - name: x\n    run: make\n    retries: 3\n";
    const out = checkPipelineYaml(src, parseDocument);
    assert.deepEqual(out.map((p) => [p.line, p.severity]), [[3, "warning"], [7, "warning"]]);
  });
});

describe("login limiter", () => {
  test("refuses an account after its limit, until the window passes, and a right password clears it", () => {
    let t = 0;
    const l = createLoginLimiter({ window: 60_000, perAccount: 3, perAddress: 100, now: () => t });
    for (let i = 0; i < 3; i++) { assert.equal(l.wait("Sean", "1.1.1.1"), 0); l.failed("Sean", "1.1.1.1"); t += 1000; }
    assert.ok(l.wait("sean", "2.2.2.2") > 0, "by account, whatever the address and case");
    t = 60_001;
    assert.equal(l.wait("sean", "2.2.2.2"), 0, "the first failure aged out");
    l.failed("sean", "2.2.2.2"); l.failed("sean", "2.2.2.2");
    l.succeeded("sean");
    assert.equal(l.wait("sean", "2.2.2.2"), 0);
  });

  test("refuses an address trying many accounts", () => {
    const l = createLoginLimiter({ window: 60_000, perAccount: 100, perAddress: 2, now: () => 0 });
    l.failed("a", "9.9.9.9"); l.failed("b", "9.9.9.9");
    assert.ok(l.wait("c", "9.9.9.9") > 0);
    assert.equal(l.wait("c", "8.8.8.8"), 0);
  });
});
