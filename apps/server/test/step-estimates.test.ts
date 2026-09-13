// What a step usually takes, and what the progress bar does with that.
//
// THE PROBLEM. A pipeline step is an arbitrary shell command. There is nothing
// inside one to measure, so the bar showed state and nothing else: full width,
// pulsing, identical at four seconds and at four minutes. It told you a step
// was running, which you could already see from the spinner beside it.
//
// There IS a signal, though: the same step has run before and its duration was
// recorded. These two rules turn that history into a bar that moves, and both
// have a way of being subtly wrong that only shows up in production - an
// estimate that shrinks whenever something breaks, or a bar that hits 100% and
// sits there while the step is still going.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { stepEstimates, SAMPLE_SIZE } from "../src/services/stepEstimates.js";
import { stepProgress, AT_ESTIMATE, CAP } from "../../client/src/helpers/stepProgress.js";

/** A build row as the database hands it over. */
const build = (target: string, status: string, timings: Record<string, number | null>) => ({
    target,
    status,
    step_timings: JSON.stringify(
        Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, { duration: v }]))
    ),
});

describe("what a step usually takes", () => {
    test("is the median, so one slow run does not poison it", () => {
        // Four normal runs and one cold cache. The mean is 2,400ms and would
        // make every later run look early for the rest of the day.
        const rows = [
            build("p", "success", { Build: 1000 }),
            build("p", "success", { Build: 1000 }),
            build("p", "success", { Build: 1000 }),
            build("p", "success", { Build: 1000 }),
            build("p", "success", { Build: 9000 }),
        ];
        assert.equal(stepEstimates(rows).get("p")?.get("Build"), 1000);
    });

    test("averages the middle two when the sample is even", () => {
        const rows = [
            build("p", "success", { Build: 1000 }),
            build("p", "success", { Build: 2000 }),
        ];
        assert.equal(stepEstimates(rows).get("p")?.get("Build"), 1500);
    });

    test("ignores runs that FAILED, which is the one that matters", () => {
        // A step that died after 50ms is not evidence that it takes 50ms. Count
        // those and the estimate collapses every time something breaks, which
        // is exactly when a truthful bar is worth having.
        const rows = [
            build("p", "failed", { Build: 50 }),
            build("p", "failed", { Build: 50 }),
            build("p", "success", { Build: 4000 }),
        ];
        assert.equal(stepEstimates(rows).get("p")?.get("Build"), 4000);
    });

    test("ignores a zero, which is what an approval gate records", () => {
        // A gate's clock runs while a person is elsewhere. A zero estimate
        // would send the bar to full the instant the gate opened.
        const rows = [build("p", "success", { Approve: 0, Build: 3000 })];
        const est = stepEstimates(rows).get("p");
        assert.equal(est?.has("Approve"), false, "a zero is not a measurement");
        assert.equal(est?.get("Build"), 3000);
    });

    test("keeps pipelines apart", () => {
        const rows = [
            build("a", "success", { Build: 1000 }),
            build("b", "success", { Build: 8000 }),
        ];
        const e = stepEstimates(rows);
        assert.equal(e.get("a")?.get("Build"), 1000);
        assert.equal(e.get("b")?.get("Build"), 8000);
    });

    test("samples only the most recent runs, so a pipeline that got slower is followed", () => {
        // Newest first, which is how getRecentBuilds returns them. Twenty runs
        // at 5s followed by older ones at 1s must estimate 5s, not something
        // in between.
        const rows = [
            ...Array.from({ length: SAMPLE_SIZE }, () => build("p", "success", { Build: 5000 })),
            ...Array.from({ length: 20 }, () => build("p", "success", { Build: 1000 })),
        ];
        assert.equal(stepEstimates(rows).get("p")?.get("Build"), 5000);
    });

    test("survives rubbish in the timings column", () => {
        const rows = [
            { target: "p", status: "success", step_timings: "not json" },
            { target: "p", status: "success", step_timings: null },
            build("p", "success", { Build: 2000 }),
        ];
        assert.equal(stepEstimates(rows).get("p")?.get("Build"), 2000);
    });

    test("says nothing about a step it has never seen succeed", () => {
        const rows = [build("p", "failed", { Build: 100 })];
        assert.equal(stepEstimates(rows).get("p")?.get("Build"), undefined);
    });
});

describe("how full the bar is", () => {
    const started = 1_000_000;

    test("is null without an estimate, so the caller draws the honest one", () => {
        assert.equal(stepProgress(undefined, started, started + 5000), null);
        assert.equal(stepProgress(0, started, started + 5000), null);
        assert.equal(stepProgress(5000, undefined, started + 5000), null);
    });

    test("tracks elapsed time against the estimate", () => {
        assert.equal(stepProgress(10_000, started, started + 5_000), AT_ESTIMATE / 2);
    });

    test("reaches the estimate short of full, not at it", () => {
        assert.equal(stepProgress(10_000, started, started + 10_000), AT_ESTIMATE);
        assert.ok(AT_ESTIMATE < 1, "a bar at 100% while still running reads as stuck");
    });

    test("keeps creeping past the estimate rather than freezing", () => {
        // A frozen bar looks like a hung interface. A crawling one looks like a
        // step taking longer than usual, which is what is actually happening.
        const a = stepProgress(10_000, started, started + 12_000)!;
        const b = stepProgress(10_000, started, started + 15_000)!;
        assert.ok(a > AT_ESTIMATE, "it moved past the estimate");
        assert.ok(b > a, "and kept moving");
    });

    test("never claims to be finished, however long it runs", () => {
        for (const elapsed of [20_000, 100_000, 86_400_000]) {
            const p = stepProgress(10_000, started, started + elapsed)!;
            assert.ok(p <= CAP, `${elapsed}ms gave ${p}, which is above the cap`);
            assert.ok(p < 1);
        }
    });

    test("a clock skewed backwards reads as just started, not as negative", () => {
        assert.equal(stepProgress(10_000, started, started - 5_000), 0);
    });
});
