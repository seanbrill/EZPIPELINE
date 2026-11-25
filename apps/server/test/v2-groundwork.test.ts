// The pure pieces of the v2 server groundwork: how step output becomes lines,
// how `git log` output becomes commits, and which commits count as pending.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LineSplitter } from "../src/services/LineSplitter.js";
import { parseLog, parseShortstat, pendingFrom, LOG_FORMAT } from "../src/services/CommitService.js";

describe("LineSplitter", () => {
  test("joins a line split across chunks and splits chunks holding several", () => {
    const out: string[] = [];
    const s = new LineSplitter((l) => out.push(l));
    s.push("hel");
    s.push("lo\nwor");
    s.push("ld\nthree\nfour\n");
    assert.deepEqual(out, ["hello", "world", "three", "four"]);
  });

  test("keeps the last frame of a carriage-return progress bar", () => {
    const out: string[] = [];
    const s = new LineSplitter((l) => out.push(l));
    s.push("10%\r50%\r100%\n");
    s.push("done\r\n");
    assert.deepEqual(out, ["100%", "done"]);
  });

  test("flushes a partial line (a prompt) on flush and after going quiet", async () => {
    const out: string[] = [];
    const s = new LineSplitter((l) => out.push(l), 20);
    s.push("Continue? ");
    assert.deepEqual(out, []);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(out, ["Continue? "]);
    s.push("tail");
    s.flush();
    assert.deepEqual(out, ["Continue? ", "tail"]);
  });

  test("keeps empty lines, which are part of the output", () => {
    const out: string[] = [];
    const s = new LineSplitter((l) => out.push(l));
    s.push("a\n\nb\n");
    assert.deepEqual(out, ["a", "", "b"]);
  });
});

describe("commit parsing", () => {
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const C = "c".repeat(40);
  // What `git log --shortstat` prints with LOG_FORMAT: a record separator,
  // fields split by unit separators, then the stat after the final one.
  const rec = (sha: string, parents: string, subject: string, body: string, stat: string) =>
    `\x1e${sha}\x1f${parents}\x1fSean\x1f2026-11-15T10:00:00+00:00\x1f${subject}\x1f${body}\x1f\n${stat}\n`;

  test("the format string is the one parseLog expects", () => {
    assert.match(LOG_FORMAT, /^--format=%x1e%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%b%x1f$/);
  });

  test("reads subject, multi-line body, parents and diffstat", () => {
    const raw =
      rec(A, B, "feat: one", "First line.\n\nSecond paragraph.", " 3 files changed, 10 insertions(+), 2 deletions(-)") +
      rec(B, `${C} ${A}`, "Merge branch x", "", " 1 file changed, 1 insertion(+)");
    const [a, b] = parseLog(raw);
    assert.equal(a.sha, A);
    assert.equal(a.shortSha, "aaaaaaa");
    assert.equal(a.subject, "feat: one");
    assert.equal(a.body, "First line.\n\nSecond paragraph.");
    assert.deepEqual([a.files, a.insertions, a.deletions], [3, 10, 2]);
    assert.deepEqual(b.parents, [C, A]);
    assert.deepEqual([b.files, b.insertions, b.deletions], [1, 1, 0]);
  });

  test("a commit with no diff has no stat rather than zeros", () => {
    const [c] = parseLog(rec(C, "", "chore: empty", "", ""));
    assert.deepEqual([c.files, c.insertions, c.deletions], [null, null, null]);
  });

  test("shortstat with only deletions", () => {
    assert.deepEqual(parseShortstat(" 2 files changed, 7 deletions(-)"), { files: 2, insertions: 0, deletions: 7 });
  });

  test("drops anything that is not a commit record", () => {
    assert.deepEqual(parseLog("warning: something\n"), []);
  });
});

describe("pending commits", () => {
  const log = ["d", "c", "b", "a"].map((x) => ({ sha: x.repeat(40) }));

  test("everything above the deployed commit", () => {
    assert.deepEqual(pendingFrom(log, "b".repeat(40)).map((c) => c.sha[0]), ["d", "c"]);
  });

  test("nothing when the head is what is deployed", () => {
    assert.deepEqual(pendingFrom(log, "d".repeat(40)), []);
  });

  test("a short sha matches", () => {
    assert.deepEqual(pendingFrom(log, "ccccccc").map((c) => c.sha[0]), ["d"]);
  });

  test("all of it when nothing was ever deployed, or the deploy is not in the list", () => {
    assert.equal(pendingFrom(log, null).length, 4);
    assert.equal(pendingFrom(log, "e".repeat(40)).length, 4);
  });
});
