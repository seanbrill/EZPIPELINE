// EZPipeline's own release pipeline (ci/ezpipeline/ezpipeline-release.yaml): it parses as a
// pipeline, and the keys it holds are kept from the steps that run packages from npm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, parseDocument } from "yaml";
import { checkPipelineYaml } from "../src/services/substeps.ts";

const src = readFileSync(new URL("../../../ci/ezpipeline/ezpipeline-release.yaml", import.meta.url), "utf8");
const steps = (parse(src) as { steps: { name: string; run: string }[] }).steps;
const step = (name: string) => steps.find((s) => s.name === name)!.run;
const KEYS = ["FILEFREAK_KEY", "FILEFREAK_SITE_KEY", "FILEFREAK_IMAGE_KEY"];

test("the release pipeline is a valid pipeline", () => {
  const problems = checkPipelineYaml(src, parseDocument).filter((p) => p.severity !== "warning");
  assert.deepEqual(problems, []);
});

test("no read key: the public folder is listed without one", () => {
  assert.doesNotMatch(src, /EZP_RELEASE_READ_KEY/);
});

test("the steps that run npm packages hold no key", () => {
  for (const name of ["Install and test", "Build the site"]) {
    const run = step(name);
    const unset = run.split("\n").find((l) => l.trim().startsWith("unset "));
    assert.ok(unset && run.indexOf(unset) < run.search(/^\s*npm (ci|run|test)/m), `${name} unsets the keys before npm`);
    for (const k of KEYS) assert.ok(unset.includes(k), `${name} unsets ${k}`);
  }
  const publish = step("Publish the installers");
  for (const line of publish.split("\n").filter((l) => l.includes("dist.mjs"))) assert.match(line, /\$nokeys /);
  assert.match(publish, /nokeys="env -u FILEFREAK_KEY -u FILEFREAK_SITE_KEY -u FILEFREAK_IMAGE_KEY"/);
});
