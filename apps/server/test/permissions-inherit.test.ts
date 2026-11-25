// Group grants reach the pipelines inside them; the most specific grant decides.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveGrant, type GranularPermission } from "../src/services/PermissionsService.js";

const g = (target: string, over: Partial<GranularPermission> = {}): GranularPermission => ({
  target, canView: true, canRun: false, canEditYaml: false, canEditEnv: false, canViewResources: false, canUseClaude: false, canUseTerminal: false, ...over,
});
const groups: Record<string, string> = { "deploy-prod": "FileFreak/Prod", "site": "FileFreak", "loose": "" };
const groupOf = (t: string) => groups[t] || null;

describe("resolveGrant", () => {
  test("a group grant reaches a pipeline in it, and in its subgroups", () => {
    const perms = [g("group:FileFreak", { canRun: true })];
    assert.equal(resolveGrant(perms, "site", groupOf)?.canRun, true);
    assert.equal(resolveGrant(perms, "deploy-prod", groupOf)?.canRun, true);
  });
  test("the nearest group wins over the one above it", () => {
    const perms = [g("group:FileFreak", { canRun: true }), g("group:FileFreak/Prod", { canRun: false })];
    assert.equal(resolveGrant(perms, "deploy-prod", groupOf)?.target, "group:FileFreak/Prod");
    assert.equal(resolveGrant(perms, "site", groupOf)?.target, "group:FileFreak");
  });
  test("a pipeline's own grant overrides its group's", () => {
    const perms = [g("group:FileFreak", { canEditYaml: true }), g("pipeline:deploy-prod", { canEditYaml: false })];
    assert.equal(resolveGrant(perms, "deploy-prod", groupOf)?.canEditYaml, false);
  });
  test("a bare group name, as v1 stored it, also counts", () => {
    assert.equal(resolveGrant([g("FileFreak", { canRun: true })], "deploy-prod", groupOf)?.canRun, true);
  });
  test("the wildcard comes last, and nothing matches outside the group", () => {
    const perms = [g("group:FileFreak"), g("*", { canRun: true, canView: false })];
    assert.equal(resolveGrant(perms, "loose", groupOf)?.target, "*");
    assert.equal(resolveGrant([g("group:FileFreak")], "loose", groupOf), null);
    assert.equal(resolveGrant([g("group:FileFreakX")], "site", groupOf), null);
  });
  test("a group target checks the groups above it", () => {
    const perms = [g("group:FileFreak", { canEditYaml: true })];
    assert.equal(resolveGrant(perms, "FileFreak/Prod", () => null)?.canEditYaml, true);
    assert.equal(resolveGrant(perms, "Other/Prod", () => null), null);
  });
  test("case does not matter", () => {
    assert.ok(resolveGrant([g("GROUP:filefreak")], "site", groupOf));
  });
});
