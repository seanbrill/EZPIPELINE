/**
 * The self-host wizard (design sheet f96–f115). Admins only, except the two
 * routes the deploy itself calls:
 *
 *   GET    /selfhost                    drafts and deploys, the regions and sizes
 *   POST   /selfhost                    a new draft
 *   GET    /selfhost/:id                one draft, its estimate, and its deploy's run
 *   PUT    /selfhost/:id                save a step's answers
 *   DELETE /selfhost/:id                discard a draft (not one with things in the cloud)
 *   GET    /selfhost/:id/profiles       the AWS CLI profiles on this host
 *   POST   /selfhost/:id/check          sign in, and ask IAM what it may do
 *   GET    /selfhost/:id/review         what gets made, the Terraform, and what would stop it
 *   POST   /selfhost/:id/bundle         the .ezp to start from (raw body)
 *   POST   /selfhost/:id/deploy         { fromStep? } start, or retry from a step
 *   POST   /selfhost/:id/finish         { choice: standby | both }
 *   POST   /selfhost/:id/remove         run "Remove from AWS"
 *
 *   POST   /selfhost/:id/move           the deploy's Move data step (x-ezp-selfhost: its token)
 *   POST   /selfhost/receive            the NEW instance's end of the move (envelope, raw body)
 */
import express, { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { authenticateToken } from "../middleware/auth.js";
import { DatabaseService } from "../services/Database.js";
import { encryptCredential } from "../services/gitCredentials.js";
import { writeEnv } from "../services/EnvLayers.js";
import { readSetup } from "../services/setup.js";
import { readZip } from "../services/zip.js";
import { APP_VERSION } from "../services/bundle.js";
import { PIPELINES_DIR, PORT } from "../config/index.js";
import EZPipelineController from "../controllers/EZPipelineController.js";
import Logger from "../controllers/Logger.js";
import { awsEstimate, SIZES, fargateMonthly, PRICES_AS_OF } from "../services/selfhost/prices.js";
import * as store from "../services/selfhost/store.js";
import { imagePublic } from "../services/selfhost/image.js";
import { DEPLOY_STEPS, IMAGE_SOURCE, deployYaml, permissionGroups, pipelineVars, policyStatement, removeYaml, resourceList, terraform } from "../services/selfhost/aws.js";
import { checkPermissions, credsEnv, identity, profiles, regionBlockers } from "../services/selfhost/connect.js";
import { buildPayload, pauseHere, receive, ReceiveError, resumeHere, seal } from "../services/selfhost/transfer.js";

const router = Router();
const GROUP = "Self-hosting";

function admin(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).user?.isAdmin) { res.status(403).json({ error: "admin_only", message: "Only an admin can deploy EZPipeline to a cloud." }); return; }
  next();
}
const fail = (res: Response, e: any) => {
  if (!e.status) Logger.getInstance().error(`[selfhost] ${e.message}`, e);
  res.status(e.status ?? 500).json({ error: e.code ?? (e.status === 404 ? "not_found" : e.status ? "bad_request" : "server_error"), message: e.status ? e.message : "That did not work. The server log has the detail." });
};
const db = () => DatabaseService.getInstance().getDb();

/** The draft as the browser sees it: never the key's secret, only whether there is one. */
function view(d: store.Draft) {
  const { secretAccessKey, ...connect } = d.connect;
  const { bundlePass, ...data } = d.data;
  return { ...d, connect: { ...connect, hasSecret: !!secretAccessKey }, data: { ...data, hasPass: !!bundlePass } };
}

function runOf(buildId: string | null) {
  if (!buildId) return null;
  const b = db().prepare("SELECT id, status, started_at, ended_at, build_number, step_timings, error FROM builds WHERE id = ?").get(buildId) as
    { id: string; status: string; started_at: string; ended_at: string | null; build_number: number; step_timings: string | null; error: string | null } | undefined;
  if (!b) return null;
  let timings: Record<string, any> = {};
  try { timings = b.step_timings ? JSON.parse(b.step_timings) : {}; } catch { /* none */ }
  // A live run keeps its step states in memory until it ends.
  const live = EZPipelineController.instance.builds?.find?.((x: any) => x.id === buildId) as any;
  const steps = DEPLOY_STEPS.map((name) => {
    const t = timings[name] ?? live?.stepTimings?.[name];
    return { name, status: t?.status ?? "pending", durationMs: t?.durationMs ?? (t?.startedAt && t?.endedAt ? Date.parse(t.endedAt) - Date.parse(t.startedAt) : null), startedAt: t?.startedAt ?? null, failure: t?.failure ?? null };
  });
  return { id: b.id, number: b.build_number, status: live && !live.ended ? (live.status ?? "running") : b.status, startedAt: b.started_at, endedAt: b.ended_at, error: b.error, steps };
}

function full(d: store.Draft) {
  return {
    draft: view(d),
    estimate: awsEstimate(d.config),
    missing: store.missing(d),
    run: d.deploy ? runOf(d.deploy.buildId) : null,
    removeRun: d.deploy?.removePipelineId ? lastRun(d.deploy.removePipelineId) : null,
    steps: DEPLOY_STEPS,
  };
}
function lastRun(pipelineId: string) {
  const b = db().prepare("SELECT id, status, started_at, ended_at, error FROM builds WHERE target = ? ORDER BY started_at DESC LIMIT 1").get(pipelineId) as any;
  return b ?? null;
}

// ── The receiving end, on the new instance: no session, the envelope is the proof ──

router.post("/selfhost/receive", express.raw({ type: "application/octet-stream", limit: "1gb" }), (req, res) => {
  try {
    const r = receive(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    Logger.getInstance().info(`Self-host: took the hand-over: ${r.users} user(s)${r.report ? `, ${r.report.pipelines.length} pipeline(s)` : ""}.`);
    res.json({ ok: true, users: r.users, report: r.report });
  } catch (e: any) {
    if (e instanceof ReceiveError) { res.status(e.status).json({ error: e.code, message: e.message }); return; }
    fail(res, e);
  }
});

// ── The Move data step, called by the deploy run on this instance ──

const moveToken = (id: string) => {
  const f = path.join(store.dirOf(id), "move.token");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("base64url"), { mode: 0o600 });
  return fs.readFileSync(f, "utf8").trim();
};
const tfSecret = (id: string, name: string): string | null => {
  const f = path.join(store.tfDir(id), "secrets.auto.tfvars");
  if (!fs.existsSync(f)) return null;
  return new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, "m").exec(fs.readFileSync(f, "utf8"))?.[1] ?? null;
};
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

router.post("/selfhost/:id/move", async (req, res) => {
  const say: string[] = [];
  try {
    const d = store.load(String(req.params.id));
    const given = String(req.headers["x-ezp-selfhost"] ?? "");
    if (!d.deploy || !given || !same(given, moveToken(d.id))) { res.status(403).json({ error: "forbidden", message: "Only this deploy's own run moves its data." }); return; }
    const to = String(req.body?.to ?? "").replace(/\/+$/, "");
    if (!/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(to)) { res.status(400).json({ error: "bad_request", message: "Where to? An http(s) address with no path." }); return; }
    const token = tfSecret(d.id, "setup_token");
    if (!token) { res.status(409).json({ error: "no_token", message: "This deploy's setup token is missing from its folder, so the new instance cannot be reached safely. Deploy again from Create service." }); return; }

    const bundleFile = d.data.mode === "bundle" ? path.join(store.dirOf(d.id), "start.ezp") : undefined;
    const final = d.config.address === "domain" ? `https://${d.config.domain}` : to;
    const { payload, counts } = buildPayload(d, { url: final, instanceName: d.data.mode === "move" ? readSetup().instance.name : d.config.name, bundleFile });
    const envelope = seal(token, Buffer.from(JSON.stringify(payload)));
    say.push(`Sending ${counts.users} user(s)${payload.bundle ? `, ${counts.pipelines} pipeline(s) in ${counts.groups} group(s), ${counts.variables} variable(s), ${counts.credentials} credential(s), ${counts.runs} run(s)` : ""}: ${envelope.length < 1 << 20 ? `${Math.ceil(envelope.length / 1024)} KB` : `${(envelope.length / (1 << 20)).toFixed(1)} MB`}, encrypted for the new instance only`);
    const r = await fetch(`${to}/api/selfhost/receive`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(envelope), signal: AbortSignal.timeout(25 * 60_000) });
    const body = await r.json().catch(() => ({})) as any;
    if (!r.ok) {
      const why = body?.error === "already_set_up"
        ? "The new instance already has users, so the move already happened or someone signed up there first. Nothing more was sent."
        : `The new instance refused it (${r.status}): ${body?.message ?? "no reason given"}`;
      res.status(502).type("text/plain").send(`${say.join("\n")}\n✗ ${why}\n`);
      return;
    }
    const rep = body.report;
    if (to.startsWith("http://")) d.deploy.lbDns = to;
    d.deploy.moved = {
      at: new Date().toISOString(), users: body.users ?? counts.users, pipelines: rep?.pipelines?.length ?? 0, groups: counts.groups,
      variables: counts.variables, credentials: counts.credentials, runs: rep?.runs ?? 0, secrets: rep?.secrets ?? "none",
    };
    say.push(`The new instance took ${d.deploy.moved.users} user(s)${rep ? `, ${rep.pipelines.length} pipeline(s) and ${rep.runs} run(s); secrets ${rep.secrets === "unlocked" ? "unsealed" : rep.secrets}` : ""}.`);
    if (rep?.pausedSchedules || rep?.pausedWatches) say.push(`Its ${rep.pausedSchedules} schedule(s) and ${rep.pausedWatches} watch(es) arrived paused; turn them on there.`);
    if (rep?.credentialsWithoutKey?.length) say.push(`These credentials arrived without their key: ${rep.credentialsWithoutKey.join(", ")}.`);
    if (d.data.mode === "move" && d.data.pauseHere && !d.deploy.pausedHere) {
      d.deploy.pausedHere = pauseHere();
      say.push(`Paused here so nothing runs twice: ${d.deploy.pausedHere.schedules.length} schedule(s), ${d.deploy.pausedHere.watches.length} watch(es).`);
    }
    store.save(d);
    res.type("text/plain").send(say.join("\n") + "\n");
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.cause?.code) { res.status(502).type("text/plain").send(`${say.join("\n")}\n✗ Could not reach the new instance: ${e.cause?.code ?? e.message}\n`); return; }
    fail(res, e);
  }
});

// ── The wizard ──

router.get("/selfhost", authenticateToken, admin, (_req, res) => {
  try {
    res.json({
      deploys: store.list().map((d) => ({ ...view(d), run: d.deploy ? runOf(d.deploy.buildId) : null })),
      regions: store.REGIONS.map(([id, label]) => ({ id, label })),
      sizes: SIZES.map((s) => ({ ...s, monthly: fargateMonthly(s.id) })),
      pricesAsOf: PRICES_AS_OF,
      dataBytes: null,
    });
  } catch (e) { fail(res, e); }
});

router.post("/selfhost", authenticateToken, admin, (req, res) => {
  try {
    const u = (req as any).user;
    const row = db().prepare("SELECT email FROM users WHERE id = ?").get(u.id) as { email: string | null } | undefined;
    res.status(201).json(full(store.newDraft({ id: u.id, username: u.username }, row?.email ?? null)));
  } catch (e) { fail(res, e); }
});

router.get("/selfhost/:id", authenticateToken, admin, (req, res) => {
  try { res.json(full(store.load(String(req.params.id)))); } catch (e) { fail(res, e); }
});

router.put("/selfhost/:id", authenticateToken, admin, (req, res) => {
  try {
    const d = store.patch(store.load(String(req.params.id)), req.body ?? {}, encryptCredential);
    store.save(d);
    res.json(full(d));
  } catch (e) { fail(res, e); }
});

router.delete("/selfhost/:id", authenticateToken, admin, (req, res) => {
  try {
    const d = store.load(String(req.params.id));
    const state = path.join(store.tfDir(d.id), "terraform.tfstate");
    if (fs.existsSync(state) && !d.deploy?.removed && /"resources":\s*\[\s*\{/.test(fs.readFileSync(state, "utf8"))) {
      res.status(409).json({ error: "still_in_cloud", message: "Things this deploy made are still in AWS. Remove them first, so nothing is left running that this instance has forgotten about." });
      return;
    }
    for (const pid of [d.deploy?.pipelineId, d.deploy?.removePipelineId]) {
      const t = pid && EZPipelineController.instance.targets.find((x) => x.id === pid);
      if (t && t.filePath) fs.rmSync(path.dirname(path.resolve(PIPELINES_DIR, t.filePath)), { recursive: true, force: true });
    }
    // The group was made for these pipelines; an empty one would only be clutter.
    const group = path.join(PIPELINES_DIR, GROUP);
    if (fs.existsSync(group) && fs.readdirSync(group).length === 0) fs.rmdirSync(group);
    store.discard(d.id);
    EZPipelineController.instance.refreshTargets();
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.get("/selfhost/:id/profiles", authenticateToken, admin, async (_req, res) => {
  try { res.json(await profiles()); } catch (e) { fail(res, e); }
});

router.post("/selfhost/:id/check", authenticateToken, admin, async (req, res) => {
  try {
    const d = store.load(String(req.params.id));
    const who = await identity(d);
    if (!who.identity) {
      d.connect.identity = null; d.connect.checked = null; store.save(d);
      res.status(400).json({ error: "not_signed_in", message: who.error });
      return;
    }
    d.connect.identity = { arn: who.identity.arn, account: who.identity.account, name: who.identity.name };
    d.connect.checked = await checkPermissions(d, who.identity);
    d.step = Math.max(d.step, 2);
    store.save(d);
    const denied = d.connect.checked.groups.filter((g) => g.needed).flatMap((g) => g.denied);
    res.json({ ...full(d), expires: who.identity.expires, statement: denied.length ? policyStatement(denied) : null });
  } catch (e) { fail(res, e); }
});

router.get("/selfhost/:id/review", authenticateToken, admin, async (req, res) => {
  try {
    const d = store.load(String(req.params.id));
    const account = d.connect.identity?.account ?? "<account>";
    const tf = terraform({ draft: d, account, version: APP_VERSION, statePath: path.join(store.tfDir(d.id), "terraform.tfstate") });
    const [blockers, image] = await Promise.all([d.connect.identity ? regionBlockers(d) : Promise.resolve([]), imagePublic(IMAGE_SOURCE(APP_VERSION))]);
    // A pass that changes nothing in the cloud: the permissions as they are now.
    const groups = permissionGroups(d);
    res.json({ ...full(d), resources: resourceList(d), terraform: tf, lines: tf.split("\n").length, blockers, image, permissions: groups.filter((g) => g.needed).length });
  } catch (e) { fail(res, e); }
});

router.post("/selfhost/:id/bundle", authenticateToken, admin, express.raw({ type: "application/octet-stream", limit: "512mb" }), (req, res) => {
  try {
    const d = store.load(String(req.params.id));
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    let manifest: any;
    try { manifest = JSON.parse(readZip(buf).get("manifest.json")?.toString("utf8") ?? "null"); } catch { manifest = null; }
    if (!manifest?.format) { res.status(400).json({ error: "not_a_bundle", message: "That is not an .ezp bundle: it has no manifest." }); return; }
    fs.writeFileSync(path.join(store.dirOf(d.id), "start.ezp"), buf, { mode: 0o600 });
    d.data.bundleFile = String(req.headers["x-file-name"] ?? "bundle.ezp").replace(/[^\w. ()-]/g, "").slice(0, 120) || "bundle.ezp";
    d.data.mode = "bundle";
    store.save(d);
    res.json({ ...full(d), bundle: { name: d.data.bundleFile, bytes: buf.length, counts: manifest.counts ?? {}, sealed: !!manifest.secrets?.sealed, from: manifest.from ?? null } });
  } catch (e) { fail(res, e); }
});

/** The local address the Move data step calls back on. */
function localUrl() {
  // Where server.ts binds (EZP_HOST); all interfaces include loopback.
  const bound = process.env.EZP_HOST;
  const host = bound && !["0.0.0.0", "::"].includes(bound) ? bound : "127.0.0.1";
  return `http://${host.includes(":") ? `[${host}]` : host}:${PORT}`;
}

/** Write (or write again) the deploy's two pipelines, its variables and its Terraform. */
function writeDeploy(d: store.Draft) {
  const account = d.connect.identity!.account;
  const tf = store.tfDir(d.id);
  fs.mkdirSync(tf, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(tf, "main.tf"), terraform({ draft: d, account, version: APP_VERSION, statePath: path.join(tf, "terraform.tfstate") }));
  const secrets = path.join(tf, "secrets.auto.tfvars");
  if (!fs.existsSync(secrets)) {
    const r = () => crypto.randomBytes(32).toString("base64url");
    fs.writeFileSync(secrets, `jwt_secret  = "${r()}"\nsetup_token = "${r()}"\n`, { mode: 0o600 });
  }
  d.deploy ??= { pipelineId: uuidv4(), removePipelineId: uuidv4(), buildId: null, startedAt: new Date().toISOString(), lbDns: null, moved: null, pausedHere: null, finished: null, removed: null };

  const vars = { ...pipelineVars(d, { dir: store.dirOf(d.id), local: localUrl(), version: APP_VERSION, account }) };
  const secretVars: Record<string, string> = { EZP_SH_MOVE_TOKEN: moveToken(d.id) };
  if (d.connect.mode === "keys") {
    const env = credsEnv(d);
    secretVars.AWS_ACCESS_KEY_ID = env.AWS_ACCESS_KEY_ID;
    secretVars.AWS_SECRET_ACCESS_KEY = env.AWS_SECRET_ACCESS_KEY;
  }
  const put = (id: string, folder: string, yaml: string, withVars: boolean) => {
    const dir = path.join(PIPELINES_DIR, GROUP, folder);
    fs.mkdirSync(path.join(dir, "resources"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".pipeline"), "");
    fs.writeFileSync(path.join(dir, ".selfhost"), d.id);
    fs.writeFileSync(path.join(dir, "pipeline.yaml"), yaml);
    const envFile = path.join(dir, ".env");
    if (!fs.existsSync(envFile)) fs.writeFileSync(envFile, `# Set by the self-host wizard for ${d.config.name}\n`, { mode: 0o600 });
    for (const [k, v] of Object.entries(vars)) writeEnv(envFile, k, String(v), false);
    if (withVars) for (const [k, v] of Object.entries(secretVars)) writeEnv(envFile, k, v, true);
    else if (secretVars.AWS_SECRET_ACCESS_KEY) { writeEnv(envFile, "AWS_ACCESS_KEY_ID", secretVars.AWS_ACCESS_KEY_ID, true); writeEnv(envFile, "AWS_SECRET_ACCESS_KEY", secretVars.AWS_SECRET_ACCESS_KEY, true); }
  };
  put(d.deploy.pipelineId, `deploy-${d.config.name}`, deployYaml(d, d.deploy.pipelineId), true);
  put(d.deploy.removePipelineId, `remove-${d.config.name}`, removeYaml(d, d.deploy.removePipelineId), false);
  EZPipelineController.instance.refreshTargets();
}

function start(pipelineId: string, by: string, fromStep?: string) {
  const c = EZPipelineController.instance;
  c.refreshTargets();
  const p = c.targets.find((t) => t.id === pipelineId);
  if (!p) throw Object.assign(new Error("The deploy pipeline is missing. Deploy again."), { status: 409 });
  if (c.builds?.some?.((b: any) => b.target === pipelineId && !b.ended)) throw Object.assign(new Error("This deploy is already running."), { status: 409, code: "already_running" });
  const build = c.start_build(p);
  c.run(p.id, build, { triggeredBy: by, fromStep }).catch((e) => Logger.getInstance().error(`Self-host run failed for ${p.id}`, e));
  return build.id as string;
}

router.post("/selfhost/:id/deploy", authenticateToken, admin, (req, res) => {
  try {
    const d = store.load(String(req.params.id));
    const miss = store.missing(d);
    if (miss.length) { res.status(400).json({ error: "not_ready", message: miss.join(" ") }); return; }
    const fromStep = typeof req.body?.fromStep === "string" && (DEPLOY_STEPS as readonly string[]).includes(req.body.fromStep) ? req.body.fromStep : undefined;
    writeDeploy(d);
    d.deploy!.buildId = start(d.deploy!.pipelineId, (req as any).user.username, fromStep);
    if (!fromStep) d.deploy!.startedAt = new Date().toISOString();
    d.step = Math.max(d.step, 6);
    store.save(d);
    res.status(202).json(full(d));
  } catch (e) { fail(res, e); }
});

router.post("/selfhost/:id/finish", authenticateToken, admin, (req, res) => {
  try {
    const d = store.load(String(req.params.id));
    if (!d.deploy) { res.status(409).json({ error: "not_deployed", message: "Nothing is deployed yet." }); return; }
    const choice = req.body?.choice === "both" ? "both" : "standby";
    if (choice === "both" && d.deploy.pausedHere) { resumeHere(d.deploy.pausedHere); d.deploy.pausedHere = null; }
    d.deploy.finished = { at: new Date().toISOString(), choice };
    d.step = 7;
    store.save(d);
    res.json(full(d));
  } catch (e) { fail(res, e); }
});

router.post("/selfhost/:id/remove", authenticateToken, admin, (req, res) => {
  try {
    const d = store.load(String(req.params.id));
    if (!d.deploy) { res.status(409).json({ error: "not_deployed", message: "Nothing was deployed, so there is nothing to remove." }); return; }
    if (req.body?.confirm !== d.config.name) { res.status(400).json({ error: "confirm", message: `Type ${d.config.name} to remove it, and the data on its volume.` }); return; }
    writeDeploy(d);
    const buildId = start(d.deploy.removePipelineId, (req as any).user.username);
    store.save(d);
    res.status(202).json({ ...full(d), removeBuildId: buildId });
  } catch (e) { fail(res, e); }
});

export default router;
