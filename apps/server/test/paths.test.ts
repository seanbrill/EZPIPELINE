// What the assistant and the MCP server are allowed to open.
//
// Every case below was reachable at some point. The rules lived in two places
// at two different strengths, and the weaker copy is the one that decides what
// an attacker gets, so these lock the merged rule in place.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assertConfigFile, containedPath, isEnvFile } from "../src/config/pipelinePaths.js";

const BASE = "/data/pipelines";

/** Runs a path through both gates the way the tool handlers do. */
function check(p: string): { allowed: boolean; why: string } {
    try {
        assertConfigFile(p);
        containedPath(BASE, p);
        return { allowed: true, why: "" };
    } catch (e: any) {
        return { allowed: false, why: e.message };
    }
}

describe("pipeline config paths", () => {
    for (const p of ["MyGroup/pipeline.yaml", "MyGroup/pipeline.yml", "deep/nest/build.YAML"]) {
        test(`allows ${p}`, () => {
            assert.equal(check(p).allowed, true, `${p} is a pipeline file and must open`);
        });
    }

    // ".env" as a suffix test let ".env.production" through to a full read.
    for (const p of [".env", ".env.production", "MyGroup/.env.local", "prod.env"]) {
        test(`blocks ${p}`, () => {
            assert.equal(check(p).allowed, false, `${p} holds secret VALUES`);
        });
    }

    // The old guard was a denylist naming only .env, so everything here was
    // readable by anyone who could ask the assistant a question.
    for (const p of ["MyGroup/id_rsa", "MyGroup/server.pem", "creds.json", "deploy.sh"]) {
        test(`blocks ${p}`, () => {
            assert.equal(check(p).allowed, false, `${p} is not a config file`);
        });
    }

    for (const p of ["../../etc/passwd", "/etc/passwd", "..\\..\\secrets.yaml"]) {
        test(`blocks escape via ${p}`, () => {
            assert.equal(check(p).allowed, false, `${p} leaves the pipelines directory`);
        });
    }

    test("a sibling directory is not inside the root", () => {
        // `fullPath.startsWith(rootDir)` answered true for this: the string
        // /data/pipelines-secrets does begin with /data/pipelines.
        assert.throws(
            () => containedPath(BASE, "../pipelines-secrets/keys.yaml"),
            /not allowed|outside/,
            "a sibling of the root must not resolve as contained"
        );
    });

    test("isEnvFile covers the whole family", () => {
        for (const n of [".env", ".env.local", ".env.production", "a/.env.staging"]) {
            assert.equal(isEnvFile(n), true, n);
        }
        assert.equal(isEnvFile("pipeline.yaml"), false);
    });
});
