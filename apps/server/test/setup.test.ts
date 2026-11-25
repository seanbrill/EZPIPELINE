// First-run setup: names that cannot become paths, and templates that are real pipelines.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseDocument, parse } from "yaml";
import { safeName, TEMPLATES } from "../src/services/setup.js";
import { checkPipelineYaml } from "../src/services/substeps.js";

describe("safeName", () => {
  test("plain names pass, trimmed", () => {
    assert.equal(safeName("  4 Seasons Wharton release "), "4 Seasons Wharton release");
    assert.equal(safeName("api_v2.1-beta"), "api_v2.1-beta");
  });
  test("anything that could be a path, or YAML, is refused", () => {
    for (const bad of ["", "../x", "a/b", "..", ".hidden", "a\\b", "x\ny", "a..b", "name: evil", "x".repeat(81)]) {
      assert.throws(() => safeName(bad), (e: any) => e.status === 400, JSON.stringify(bad));
    }
  });
});

describe("templates", () => {
  for (const t of TEMPLATES) {
    test(`${t.id} is a valid pipeline that keeps its id and name`, () => {
      const src = t.yaml({ id: "abc-123", name: 'Quote " and: colon', author: "admin" });
      assert.deepEqual(checkPipelineYaml(src, parseDocument), []);
      const doc = parse(src);
      assert.equal(doc.id, "abc-123");
      assert.equal(doc.appName, 'Quote " and: colon');
      assert.ok(Array.isArray(doc.steps) && doc.steps.length > 0);
    });
  }
  test("the terraform template has its approval gate", () => {
    const src = TEMPLATES.find((t) => t.id === "terraform")!.yaml({ id: "x", name: "tf", author: "a" });
    assert.ok(parse(src).steps.some((s: any) => s.type === "approval"));
  });
});
