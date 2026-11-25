import { test } from "node:test";
import assert from "node:assert/strict";
import { exitMeaning, failureLines, failureSummary, outcome, startMeaning, variablesInTrouble, type FailureDetail } from "../src/services/stepFailure.ts";

test("exit codes that have a usual meaning say it", () => {
  assert.match(exitMeaning(127, null)!, /not found/);
  assert.match(exitMeaning(126, null)!, /could not be run/);
  assert.match(exitMeaning(137, null)!, /SIGKILL.*memory/);
  assert.match(exitMeaning(null, "SIGKILL")!, /memory/);
  assert.match(exitMeaning(143, null)!, /SIGTERM/);
  assert.equal(exitMeaning(1, null), null);
});

test("a shell that is not there is named", () => {
  const e = Object.assign(new Error("spawn /bin/zsh ENOENT"), { code: "ENOENT" });
  assert.match(startMeaning(e, "/bin/zsh", "/w"), /shell \/bin\/zsh is not on this server/);
});

test("variables the command reads but nobody set are found", () => {
  const env = { SITE_URL: "", HOME: "/root", REGION: "eu" };
  const r = variablesInTrouble('curl -fsS "$SITE_URL/${PATH_PART}" && echo $REGION ${MISSING:-x} $lower', env);
  assert.deepEqual(r.unset, ["PATH_PART"]);
  assert.deepEqual(r.empty, ["SITE_URL"]);
});

test("a variable the script sets itself is not reported", () => {
  const cmd = 'TAG=$(git rev-parse HEAD)\nexport OUT=dist\nfor F in a b; do echo $F; done\nread -r NAME\necho $TAG $OUT $NAME $RANDOM $PWD';
  assert.deepEqual(variablesInTrouble(cmd, {}), { unset: [], empty: [] });
});

const d: FailureDetail = {
  exitCode: 127, signal: null, meaning: exitMeaning(127, null), lastLines: ["", "sh: 1: kubectl: not found"],
  command: "kubectl apply -f k8s/", cwd: "/data/p/workspace", shell: "/bin/sh", durationMs: 1200, unset: ["KUBECONFIG"], empty: [],
};

test("the log block names the command, folder, shell, meaning and PATH on a 127", () => {
  const { headline, lines } = failureLines('Step "Deploy"', d, "/usr/bin:/bin");
  assert.equal(headline, '✗ Step "Deploy" failed: exit code 127');
  const all = lines.join("\n");
  for (const want of ["meaning  a command was not found", "command  kubectl apply -f k8s/", "folder   /data/p/workspace", "shell    /bin/sh", "ran for  1.2s", "not set  KUBECONFIG", "PATH     /usr/bin:/bin"]) {
    assert.ok(all.includes(want), `missing "${want}" in\n${all}`);
  }
});

test("PATH is only shown when a command was not found", () => {
  assert.ok(!failureLines("x", { ...d, exitCode: 1, meaning: null }, "/usr/bin").lines.some((l) => l.includes("PATH")));
});

test("a long script is not repeated in full", () => {
  const { lines } = failureLines("x", { ...d, command: "a\nb\nc\nd\ne" }, "");
  assert.ok(lines.some((l) => l.includes("a … (5 lines")));
});

test("the one-line summary ends with the last thing the step printed", () => {
  assert.equal(failureSummary("Deploy", d), "Deploy failed with exit code 127: sh: 1: kubectl: not found");
  assert.equal(failureSummary("Build", { ...d, substep: "11.3.2", lastLines: [] }), "Build › 11.3.2 failed with exit code 127");
  assert.equal(failureSummary("Build", { ...d, substep: "11.3.2", substepName: "Push", lastLines: [] }), "Build › 11.3.2 Push failed with exit code 127");
  assert.equal(outcome({ exitCode: null, signal: "SIGKILL" }), "stopped by SIGKILL");
});
