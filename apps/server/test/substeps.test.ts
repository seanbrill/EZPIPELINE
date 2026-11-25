// Substeps: the YAML shape check, the ::ezp marker grammar, and the tree a run builds.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseMarker, validateSteps, SubstepTracker, MAX_DEPTH, type Substep } from "../src/services/substeps.js";

describe("validateSteps", () => {
  test("a plain list of commands is fine", () => {
    assert.deepEqual(validateSteps([{ name: "Build", run: "make" }, { name: "Gate", type: "approval" }]), []);
  });

  test("nested steps are fine and checked all the way down", () => {
    const ok = [{ name: "Images", steps: [{ name: "api", run: "docker build ." }, { name: "worker", steps: [{ name: "push", run: "docker push" }] }] }];
    assert.deepEqual(validateSteps(ok), []);
    const bad = [{ name: "Images", steps: [{ name: "api" }] }];
    assert.deepEqual(validateSteps(bad), ['steps[0].steps[0] ("api") needs run or steps']);
  });

  test("run and steps together are refused, as is neither", () => {
    assert.match(validateSteps([{ name: "x", run: "a", steps: [{ name: "y", run: "b" }] }])[0], /both run and steps/);
    assert.match(validateSteps([{ name: "x" }])[0], /needs run or steps/);
  });

  test("gates and actions stay at the top level and have no children", () => {
    assert.match(validateSteps([{ name: "p", steps: [{ name: "g", type: "approval" }] }]).join(), /only be at the top level/);
    assert.match(validateSteps([{ name: "g", type: "approval", steps: [{ name: "a", run: "x" }] }]).join(), /cannot have substeps/);
  });

  test("depth is limited", () => {
    let node: any = { name: "leaf", run: "true" };
    for (let i = 0; i < MAX_DEPTH; i++) node = { name: `l${i}`, steps: [node] };
    assert.match(validateSteps([node]).join(), /levels deep at most/);
  });

  test("shapes: not a list, empty, unnamed, wrong types", () => {
    assert.deepEqual(validateSteps(undefined), ["steps must be a list"]);
    assert.deepEqual(validateSteps([]), ["steps is empty"]);
    assert.match(validateSteps([{ run: "x" }])[0], /needs a name/);
    assert.match(validateSteps([{ name: "x", run: "a", env: ["A=1"] }]).join(), /env must be a mapping/);
  });
});

describe("parseMarker", () => {
  test("the four markers", () => {
    assert.deepEqual(parseMarker("::ezp step Push to the registry"), { kind: "step", name: "Push to the registry" });
    assert.deepEqual(parseMarker("::ezp done"), { kind: "done" });
    assert.deepEqual(parseMarker("::ezp fail exit 3"), { kind: "fail", message: "exit 3" });
    assert.deepEqual(parseMarker("::ezp progress 3/10 files"), { kind: "progress", done: 3, total: 10, unit: "files" });
    assert.deepEqual(parseMarker("  ::ezp progress 3 / 10"), { kind: "progress", done: 3, total: 10, unit: null });
  });

  test("anything else is an ordinary line", () => {
    for (const l of ["echo ::ezp step x", "::ezp step", "::ezp progress lots", "::ezpstep x", "::ezp steps x", ""]) {
      assert.equal(parseMarker(l), null, l);
    }
  });
});

function track() {
  const saved: Substep[] = [];
  let t = 0;
  const tr = new SubstepTracker((s) => saved.push(s), () => ++t);
  const last = (path: string) => [...saved].reverse().find((s) => s.path === path);
  return { tr, saved, last };
}

describe("SubstepTracker", () => {
  test("YAML children are pending up front, then run in order", () => {
    const { tr, last } = track();
    tr.beginStep(10, { name: "Images", steps: [{ name: "api", run: "a" }, { name: "worker", steps: [{ name: "build", run: "b" }, { name: "push", run: "c" }] }] });
    assert.equal(last("11.2.2")?.status, "pending");
    tr.enter("11.1");
    assert.equal(tr.current(), "11.1");
    tr.leave("11.1", true);
    tr.enter("11.2");
    tr.enter("11.2.1");
    tr.leave("11.2.1", true);
    tr.enter("11.2.2");
    tr.leave("11.2.2", false);
    tr.leave("11.2", false);
    tr.endStep(false);
    assert.equal(last("11.1")?.status, "success");
    assert.equal(last("11.2.1")?.status, "success");
    assert.equal(last("11.2.2")?.status, "failed");
    assert.equal(last("11.2")?.status, "failed");
    assert.equal(tr.current(), null);
  });

  test("markers open children, nest, and are not log lines", () => {
    const { tr, last } = track();
    tr.beginStep(0, { name: "Deploy", run: "./deploy.sh" });
    assert.equal(tr.line("hello"), false);
    assert.equal(tr.line("::ezp step Upload"), true);
    assert.equal(tr.current(), "1.1");
    tr.line("::ezp step Part A");
    assert.equal(tr.current(), "1.1.1");
    tr.line("::ezp done");
    tr.line("::ezp step Part B");
    assert.equal(tr.current(), "1.1.2");
    tr.line("::ezp fail");
    tr.line("::ezp done");
    tr.line("::ezp step Verify");
    assert.equal(tr.current(), "1.2");
    tr.endStep(true);
    assert.equal(last("1.1.1")?.status, "success");
    assert.equal(last("1.1.2")?.status, "failed");
    assert.equal(last("1.1")?.status, "success");
    assert.equal(last("1.2")?.status, "success", "left open, closed with the step");
  });

  test("a failing command fails what its markers left open, but not more", () => {
    const { tr, last } = track();
    tr.beginStep(0, { name: "P", steps: [{ name: "leaf", run: "x" }] });
    tr.enter("1.1");
    tr.line("::ezp step inner");
    tr.closeMarkers(false);
    assert.equal(tr.current(), "1.1", "the YAML node stays open for leave()");
    tr.leave("1.1", false);
    assert.equal(last("1.1.1")?.status, "failed");
    assert.equal(last("1.1")?.status, "failed");
  });

  test("done with nothing open is ignored; progress lands on the innermost node or the step", () => {
    const { tr, last } = track();
    tr.beginStep(2, { name: "Sync", run: "x" });
    tr.line("::ezp done");
    assert.equal(tr.current(), null);
    tr.line("::ezp progress 4/9 files");
    assert.deepEqual([last("3")?.name, last("3")?.done, last("3")?.total, last("3")?.unit], ["Sync", 4, 9, "files"]);
    tr.line("::ezp step one");
    tr.line("::ezp progress 12/10");
    assert.equal(last("3.1")?.done, 10, "clamped to the total");
    tr.endStep(true);
    assert.equal(last("3")?.status, "success");
  });

  test("markers inside a YAML leaf number after nothing, under that leaf", () => {
    const { tr } = track();
    tr.beginStep(0, { name: "P", steps: [{ name: "a", run: "x" }, { name: "b", run: "y" }] });
    tr.enter("1.2");
    tr.line("::ezp step m");
    assert.equal(tr.current(), "1.2.1");
  });
});

import { parseDocument } from "yaml";
import { checkPipelineYaml } from "../src/services/substeps.js";
describe("checkPipelineYaml", () => {
  test("a good file has no problems", () => {
    assert.deepEqual(checkPipelineYaml("id: a\nappName: A\nsteps:\n  - name: x\n    run: echo\n", parseDocument), []);
  });
  test("step problems point at their line", () => {
    const src = "id: a\nappName: A\nsteps:\n  - name: x\n    run: echo\n  - name: y\n    steps:\n      - name: z\n";
    const p = checkPipelineYaml(src, parseDocument);
    assert.equal(p.length, 1);
    assert.equal(p[0].line, 8);
    assert.match(p[0].message, /needs run or steps/);
  });
  test("syntax errors come first, with a line", () => {
    const p = checkPipelineYaml("id: a\nsteps:\n  - name: [unclosed\n", parseDocument);
    assert.ok(p.length >= 1 && typeof p[0].line === "number");
  });
});
