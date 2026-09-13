// Which status a build write lands, and why the approval gate needed it.
//
// THE BUG THIS WAS WRITTEN FOR. updateBuild assembled its SQL by inferring a
// status - failed from an error, aborted from a flag, success from a finished
// percentage - and had no branch for one passed in. So this call:
//
//     updateBuild(id, { stepTimings, status: 'paused' })
//
// wrote the step timings and silently dropped the status. The approval gate
// makes exactly that call. The runner logged "Waiting for user approval",
// genuinely parked, and left the row saying `running` forever.
//
// Nobody noticed for months because every gate that had ever been reached was
// released by a git watch with auto-approve on, which resumes through a
// different path. The first MANUAL approval - provisioning production - sat
// there with no way to release it.
//
// The ORDER is the part worth locking down. Outcomes have to beat states: a
// call carrying both an error and a stale status must land failed, or a
// crashed build reports itself as merely paused and nothing ever cleans it up.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { statusToWrite } from "../src/services/BuildService.js";

describe("an explicitly passed status", () => {
    test("is written, which is the whole bug", () => {
        assert.equal(
            statusToWrite({ stepTimings: {}, status: 'paused' }),
            'paused',
            "the approval gate passes status: 'paused' and it must reach the database"
        );
    });

    test("survives being passed alongside other fields", () => {
        // The real call carries stepTimings too. An implementation that only
        // looked at status when it was the sole key would pass the test above
        // and fail in production.
        assert.equal(
            statusToWrite({ activeStep: "Authorise the first change to production", percentage: 47, status: 'paused' }),
            'paused'
        );
    });

    test("can set any state, not just the three that were inferred", () => {
        assert.equal(statusToWrite({ status: 'running' }), 'running');
        assert.equal(statusToWrite({ status: 'success' }), 'success');
    });
});

describe("outcomes still beat states", () => {
    test("an error lands failed even when a status says otherwise", () => {
        // A build that crashed while paused must not report itself as paused:
        // nothing revisits a paused row, so it would sit there forever.
        assert.equal(
            statusToWrite({ error: "boom", status: 'paused' }),
            'failed',
            "an error is how a build ENDED and cannot be argued with"
        );
    });

    test("an abort lands aborted even when a status says otherwise", () => {
        assert.equal(statusToWrite({ isAborted: true, status: 'running' }), 'aborted');
    });

    test("but a stated status still beats the percentage inference", () => {
        // The inference exists for callers that report progress and nothing
        // else. A caller that names a state has said more, not less.
        assert.equal(
            statusToWrite({ percentage: 100, status: 'paused' }),
            'paused',
            "a final step that is itself a gate must not be recorded as finished"
        );
    });
});

describe("what was there before still works", () => {
    test("an error alone infers failed", () => {
        assert.equal(statusToWrite({ error: "boom" }), 'failed');
    });

    test("an abort alone infers aborted", () => {
        assert.equal(statusToWrite({ isAborted: true }), 'aborted');
    });

    test("a completed percentage alone infers success", () => {
        assert.equal(statusToWrite({ percentage: 100 }), 'success');
    });

    test("a partial percentage infers nothing", () => {
        // UNDEFINED IS NOT A STATUS. Returning a string here would mean every
        // progress update rewrote the status column, which is how a paused
        // build would get shoved back to running by the next tick.
        assert.equal(statusToWrite({ percentage: 47 }), undefined);
    });

    test("an update with nothing to say writes no status", () => {
        assert.equal(statusToWrite({ activeStep: "Deploy" }), undefined);
    });
});
