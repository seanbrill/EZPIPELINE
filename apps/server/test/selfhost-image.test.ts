// Can a new instance pull the self-host image with no key? Asked of a fake registry.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { challenge, imagePublic, parseRef, type Fetch } from "../src/services/selfhost/image.ts";
import { IMAGE_SOURCE } from "../src/services/selfhost/aws.ts";

const REF = "api.filefreak.io/ezpipeline/ezpipeline:2.0.0";

/** A registry: `root` answers /v2/, `token` the token service, `manifest` the HEAD. */
function registry(o: { root: Response; token?: Response; manifest?: (auth: string | null) => Response }) {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const h = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", auth: h.get("authorization") });
    if (url.endsWith("/v2/")) return o.root;
    if (url.includes("/v2/token")) return o.token ?? new Response("", { status: 500 });
    return o.manifest ? o.manifest(h.get("authorization")) : new Response("", { status: 404 });
  }) as Fetch;
  return { f, calls };
}

const bearer = () => new Response("", { status: 401, headers: { "www-authenticate": 'Bearer realm="https://api.filefreak.io/v2/token",service="api.filefreak.io"' } });

describe("self-host image", () => {
  test("the default image is the running version on FileFreak's registry", () => {
    const before = process.env.EZP_SELFHOST_IMAGE;
    delete process.env.EZP_SELFHOST_IMAGE;
    assert.equal(IMAGE_SOURCE("2.0.0"), REF);
    process.env.EZP_SELFHOST_IMAGE = "registry.example.com/team/ezp";
    assert.equal(IMAGE_SOURCE("2.0.0"), "registry.example.com/team/ezp:2.0.0");
    if (before === undefined) delete process.env.EZP_SELFHOST_IMAGE; else process.env.EZP_SELFHOST_IMAGE = before;
  });

  test("parseRef", () => {
    assert.deepEqual(parseRef(REF), { host: "api.filefreak.io", repo: "ezpipeline/ezpipeline", tag: "2.0.0" });
    assert.deepEqual(parseRef("localhost:5000/a/b"), { host: "localhost:5000", repo: "a/b", tag: "latest" });
    assert.equal(parseRef("ezpipeline:2.0.0"), null);
  });

  test("challenge", () => {
    const c = challenge('Bearer realm="https://x/token",service="x",scope="repository:a:pull"');
    assert.equal(c?.scheme, "bearer");
    assert.equal(c?.params.realm, "https://x/token");
    assert.equal(c?.params.scope, "repository:a:pull");
    assert.equal(challenge(null), null);
  });

  test("public: a visitor's token pulls the manifest", async () => {
    const { f, calls } = registry({
      root: bearer(),
      token: Response.json({ token: "visitor" }),
      manifest: (auth) => new Response("", { status: auth === "Bearer visitor" ? 200 : 401 }),
    });
    const r = await imagePublic(REF, f);
    assert.deepEqual(r, { ref: REF, ok: true, reason: null });
    const tok = new URL(calls[1].url);
    assert.equal(tok.searchParams.get("scope"), "repository:ezpipeline/ezpipeline:pull");
    assert.equal(tok.searchParams.get("service"), "api.filefreak.io");
    assert.equal(calls[2].method, "HEAD");
    assert.match(calls[2].url, /\/v2\/ezpipeline\/ezpipeline\/manifests\/2\.0\.0$/);
  });

  test("private: the manifest is refused to a visitor", async () => {
    const { f } = registry({ root: bearer(), token: Response.json({ token: "visitor" }), manifest: () => new Response("", { status: 401 }) });
    const r = await imagePublic(REF, f);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /not public, or has not been pushed yet \(401\)/);
  });

  test("not pushed yet", async () => {
    const { f } = registry({ root: bearer(), token: Response.json({ token: "visitor" }) });
    const r = await imagePublic(REF, f);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /not published/);
  });

  test("a registry that answers Basic lets nobody pull without a key", async () => {
    const { f, calls } = registry({ root: new Response("", { status: 401, headers: { "www-authenticate": 'Basic realm="registry"' } }) });
    const r = await imagePublic(REF, f);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /lets nobody pull without a key/);
    assert.equal(calls.length, 1);
  });

  test("the token service refuses", async () => {
    const { f } = registry({ root: bearer(), token: new Response("", { status: 403 }) });
    const r = await imagePublic(REF, f);
    assert.match(r.reason ?? "", /refused a visitor \(403\)/);
  });

  test("an open registry needs no token", async () => {
    const { f, calls } = registry({ root: new Response("{}", { status: 200 }), manifest: () => new Response("", { status: 200 }) });
    assert.equal((await imagePublic(REF, f)).ok, true);
    assert.equal(calls.length, 2);
  });

  test("unreachable", async () => {
    const f = (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as Fetch;
    const r = await imagePublic(REF, f);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /could not be reached: getaddrinfo ENOTFOUND/);
  });
});
