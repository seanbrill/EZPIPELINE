// .ezp bundles: the zip layer and the sealing. The scope round trips run
// against a live server in the e2e script, since they need real pipelines.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import zlib from "zlib";
import { readZip, safeEntryName, writeZip } from "../src/services/zip.js";
import { newSeal, openSeal } from "../src/services/bundle.js";

describe("zip", () => {
  test("what is written reads back byte for byte", () => {
    const big = Buffer.alloc(200_000, "a");
    const bin = Buffer.from([0, 1, 2, 255, 254]);
    const z = writeZip([{ name: "manifest.json", data: Buffer.from("{}") }, { name: "a/b/c.txt", data: big }, { name: "bin", data: bin }, { name: "ünï/código.yaml", data: Buffer.from("x: 1") }]);
    const m = readZip(z);
    assert.equal(m.size, 4);
    assert.ok(m.get("a/b/c.txt")!.equals(big));
    assert.ok(m.get("bin")!.equals(bin));
    assert.equal(m.get("ünï/código.yaml")!.toString(), "x: 1");
    assert.ok(z.length < 10_000, "compressible data is compressed");
  });

  test("names that could escape the folder are refused, writing and reading", () => {
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b", "a//b", "./x", ""]) {
      assert.equal(safeEntryName(bad), false, bad);
      assert.throws(() => writeZip([{ name: bad, data: Buffer.from("x") }]));
    }
    // A zip made elsewhere with a traversal name: patch a safe name in place.
    const z = writeZip([{ name: "aa/x", data: Buffer.from("x") }]);
    const evil = Buffer.from(z.toString("latin1").replaceAll("aa/x", "../x"), "latin1");
    assert.throws(() => readZip(evil), (e: any) => e.status === 400 && /unsafe/.test(e.message));
  });

  test("a changed byte is caught", () => {
    const z = writeZip([{ name: "f", data: Buffer.from("hello world, hello world") }]);
    const bad = Buffer.from(z);
    bad[32] ^= 0xff; // inside the data
    assert.throws(() => readZip(bad), (e: any) => e.status === 400);
  });

  test("a bomb that claims a small size is stopped at that size", () => {
    const huge = zlib.deflateRawSync(Buffer.alloc(5_000_000));
    const z = writeZip([{ name: "f", data: Buffer.from("tiny") }]);
    // Rebuild by hand: same headers saying 4 bytes, but a body that inflates to 5 MB.
    const lh = z.subarray(0, 30 + 1);
    const local = Buffer.concat([lh, huge]);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(huge.length, 18);
    const cd = Buffer.from(z.subarray(30 + 1 + 4, z.length - 22));
    cd.writeUInt16LE(8, 10); cd.writeUInt32LE(huge.length, 20);
    const end = Buffer.from(z.subarray(z.length - 22));
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(local.length, 16);
    assert.throws(() => readZip(Buffer.concat([local, cd, end])), (e: any) => e.status === 400);
  });

  test("not a zip says so", () => {
    assert.throws(() => readZip(Buffer.from("just text")), (e: any) => /not a zip/.test(e.message));
  });
});

describe("sealing", () => {
  test("the right passphrase opens it, a wrong one does not", () => {
    const { seal } = newSeal("correct horse battery");
    assert.ok(openSeal(seal, "correct horse battery"));
    assert.equal(openSeal(seal, "correct horse batterY"), null);
    assert.ok(!JSON.stringify(seal).includes("correct horse"), "the passphrase is not in the seal");
  });
  test("a short passphrase is refused", () => {
    assert.throws(() => newSeal("short"), (e: any) => e.status === 400);
  });
  test("a seal that asks for absurd memory is not tried", () => {
    const { seal } = newSeal("correct horse battery");
    assert.equal(openSeal({ ...seal, N: 2 ** 24 }, "correct horse battery"), null);
  });
});
