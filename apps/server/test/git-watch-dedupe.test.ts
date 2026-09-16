// A promote should produce ONE deploy, not two.
//
// ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────
//
// The promote action does two things in order: merge develop into main, then
// run the production pipeline. The merge moves the branch the git watch is
// watching, so one press produced two deploys of the same commit - the one
// somebody asked for, and one the poller added a few seconds later.
//
// The existing isBuilding() guard did not prevent that, it only delayed it:
// that tick returned WITHOUT recording the sha, so the next tick started the
// duplicate as soon as the first run finished. Every promote cost a second
// full deployment of an identical sha, and it looked deliberate enough that it
// took somebody asking "what is build 27?" to notice.
//
// ── WHY THE OMISSIONS ARE THE INTERESTING PART ─────────────────────────────
//
// It would be easy to write this rule as "has a build of this sha" and be
// wrong in the direction that is hardest to notice: a watch that will never
// retry a commit after a failure. These cases pin the two that must NOT count.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shaCountsAsBuilt, BUILT_STATUSES } from "../src/services/GitWatchService.js";

describe("which statuses mean a commit is already handled", () => {
    test("a successful build means there is nothing to do", () => {
        assert.equal(shaCountsAsBuilt("success"), true);
    });

    test("a running build of the same sha is not duplicated", () => {
        // The promote case exactly: the explicit run is in flight when the
        // watch notices the branch it moved.
        assert.equal(shaCountsAsBuilt("running"), true);
    });

    test("a paused build counts, because somebody is about to decide on it", () => {
        // Starting a second build beside one waiting at an approval gate helps
        // nobody and gives two things to approve.
        assert.equal(shaCountsAsBuilt("paused"), true);
    });

    test("a FAILED build does not count, so a retry is still possible", () => {
        // The case that matters most. A failed build is an attempt, not an
        // outcome; refusing to run again because the last try failed is the
        // worst possible reading of "already done", and it would arrive at
        // exactly the moment somebody had fixed the cause.
        assert.equal(shaCountsAsBuilt("failed"), false);
    });

    test("an ABORTED build does not count either", () => {
        // Somebody stopped it on purpose. Re-running the same commit is a
        // reasonable next thing to want.
        assert.equal(shaCountsAsBuilt("aborted"), false);
    });

    test("an unknown status never counts as built", () => {
        // Fails open toward running, which is the safe direction: an extra
        // deploy of the right commit is recoverable, a deploy that never
        // happens is silent.
        assert.equal(shaCountsAsBuilt("something_new"), false);
    });

    test("the exported list and the predicate cannot drift", () => {
        // The SQL builds its IN (...) from BUILT_STATUSES, so this is what
        // stops the query and the rule disagreeing.
        for (const s of BUILT_STATUSES) assert.equal(shaCountsAsBuilt(s), true);
    });
});
