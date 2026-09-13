// How long a step took, written to fit the box it is written in.
//
// THE BUG. A running step card shows elapsed time and the usual time together.
// In the long form that reads "1min 51s / ~3min 59s" - twenty characters in a
// card about 120px wide. It wrapped to a second line, and because the card
// pins its progress bar to the bottom of that row, the wrapped line and the
// bar were drawn on top of each other.
//
// The compact form exists for that pairing and nothing else. The long form is
// still what a finished step shows, where there is one value and room for it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    formatDuration,
    formatDurationCompact,
} from "../../client/src/helpers/formatDuration.js";

const s = (n: number) => n * 1000;
const m = (n: number) => n * 60_000;

describe("the compact form", () => {
    test("is short enough for the pairing that broke the card", () => {
        // The exact values from the card that wrapped.
        const pair = `${formatDurationCompact(m(1) + s(51))} / ~${formatDurationCompact(m(3) + s(59))}`;
        assert.equal(pair, "1m51s / ~3m59s");
        assert.ok(
            pair.length <= 14,
            `"${pair}" is ${pair.length} characters; the long form was 20 and wrapped`
        );
    });

    test("drops seconds once there are hours, because nobody reads them there", () => {
        assert.equal(formatDurationCompact(3600_000 + m(15) + s(38)), "1h15m");
        assert.equal(formatDurationCompact(3600_000), "1h");
    });

    test("drops a zero remainder rather than printing it", () => {
        assert.equal(formatDurationCompact(m(2)), "2m");
        assert.equal(formatDurationCompact(m(2) + s(30)), "2m30s");
    });

    test("keeps a tenth below ten seconds, where it is the whole story", () => {
        assert.equal(formatDurationCompact(s(3.4)), "3.4s");
        assert.equal(formatDurationCompact(10), "<1s");
    });

    test("refuses nonsense the same way the long form does", () => {
        for (const bad of [null, undefined, NaN, -5]) {
            assert.equal(formatDurationCompact(bad as number), "--");
        }
    });

    test("is never longer than the long form", () => {
        // The one property that matters: it exists to save space, so a value
        // where it saved none would be a bug hiding in an edge case.
        for (const ms of [10, 999, s(9.9), s(10), s(59), m(1), m(1) + s(51), m(59) + s(59),
                          3600_000, 3600_000 + m(15) + s(38), 86_400_000]) {
            assert.ok(
                formatDurationCompact(ms).length <= formatDuration(ms).length,
                `${ms}ms: compact "${formatDurationCompact(ms)}" is longer than "${formatDuration(ms)}"`
            );
        }
    });
});

describe("the long form still behaves", () => {
    test("is unchanged for a finished step", () => {
        assert.equal(formatDuration(m(1) + s(51)), "1min 51s");
        assert.equal(formatDuration(m(2)), "2min");
        assert.equal(formatDuration(s(3.4)), "3.4s");
    });
});
