/**
 * The self-host wizard's answers, kept as a draft until Deploy, then as the record
 * of what was deployed. One folder per deploy, under the data directory:
 *
 *   data/selfhost/<id>/draft.json      the answers and what the deploy has done
 *   data/selfhost/<id>/tf/             the Terraform, its state, and its secret variables (mode 600)
 *
 * Nothing secret is in draft.json except a pasted access key's secret, which is
 * encrypted the way deploy keys are. The new instance's own secrets (its JWT secret,
 * its setup token) are in tf/secrets.auto.tfvars, which only Terraform reads.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../../config/index.js";
import { SIZES, type SizeId } from "./prices.js";

export type Cloud = "aws";
export interface Draft {
  id: string;
  cloud: Cloud;
  /** The furthest step reached, 1 to 7. */
  step: number;
  by: { id: number; username: string };
  connect: {
    mode: "profile" | "keys";
    profile: string;
    accessKeyId: string;
    /** gitcred:v1:… — encrypted with the instance's key. */
    secretAccessKey: string;
    identity: { arn: string; account: string; name: string } | null;
    checked: Check | null;
  };
  config: {
    name: string;
    region: string;
    adminEmail: string;
    size: SizeId;
    storageGb: number;
    address: "lb" | "domain";
    domain: string;
    staticIp: boolean;
  };
  data: { mode: "fresh" | "move" | "bundle"; bundleFile: string; /** The chosen bundle's passphrase, encrypted like a deploy key. */ bundlePass: string; history: "none" | "last50" | "all"; pauseHere: boolean };
  deploy: Deploy | null;
  createdAt: string;
  updatedAt: string;
}
export interface Check { at: string; groups: CheckGroup[]; note: string | null; error: string | null }
export interface CheckGroup { id: string; label: string; actions: string[]; denied: string[]; needed: boolean }
export interface Deploy {
  pipelineId: string;
  removePipelineId: string;
  buildId: string | null;
  startedAt: string;
  /** The load balancer's own name, once Terraform has made it. */
  lbDns: string | null;
  moved: MoveReport | null;
  /** Schedules and watches this instance paused when the move finished, so "Keep both" can turn exactly those back on. */
  pausedHere: { schedules: number[]; watches: number[] } | null;
  finished: { at: string; choice: "standby" | "both" } | null;
  removed: string | null;
}
export interface MoveReport { at: string; users: number; pipelines: number; groups: number; variables: number; credentials: number; runs: number; secrets: string }

export const SELFHOST_DIR = () => path.join(DATA_DIR, "selfhost");
const ID = /^[a-z0-9]{12}$/;
export const dirOf = (id: string) => {
  if (!ID.test(id)) throw Object.assign(new Error("No such deploy."), { status: 404 });
  return path.join(SELFHOST_DIR(), id);
};
export const tfDir = (id: string) => path.join(dirOf(id), "tf");

const bad = (m: string) => Object.assign(new Error(m), { status: 400 });

export function newDraft(by: { id: number; username: string }, email: string | null): Draft {
  const now = new Date().toISOString();
  const d: Draft = {
    id: crypto.randomBytes(6).toString("hex"),
    cloud: "aws", step: 1, by,
    connect: { mode: "profile", profile: "default", accessKeyId: "", secretAccessKey: "", identity: null, checked: null },
    config: { name: "ezpipeline", region: "us-east-1", adminEmail: email ?? "", size: "1", storageGb: 20, address: "lb", domain: "", staticIp: false },
    data: { mode: "move", bundleFile: "", bundlePass: "", history: "last50", pauseHere: true },
    deploy: null, createdAt: now, updatedAt: now,
  };
  save(d);
  return d;
}

export function save(d: Draft) {
  d.updatedAt = new Date().toISOString();
  fs.mkdirSync(dirOf(d.id), { recursive: true, mode: 0o700 });
  const f = path.join(dirOf(d.id), "draft.json");
  fs.writeFileSync(f + ".tmp", JSON.stringify(d, null, 2), { mode: 0o600 });
  fs.renameSync(f + ".tmp", f);
}

export function load(id: string): Draft {
  const f = path.join(dirOf(id), "draft.json");
  if (!fs.existsSync(f)) throw Object.assign(new Error("No such deploy."), { status: 404 });
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

export function list(): Draft[] {
  if (!fs.existsSync(SELFHOST_DIR())) return [];
  return fs.readdirSync(SELFHOST_DIR()).filter((x) => ID.test(x)).flatMap((x) => {
    try { return [load(x)]; } catch { return []; }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function discard(id: string) {
  fs.rmSync(dirOf(id), { recursive: true, force: true });
}

/** Region names: lower-case words and digits, as AWS writes them. */
export const REGIONS = [
  ["us-east-1", "N. Virginia"], ["us-east-2", "Ohio"], ["us-west-1", "N. California"], ["us-west-2", "Oregon"],
  ["ca-central-1", "Canada (Central)"], ["eu-west-1", "Ireland"], ["eu-west-2", "London"], ["eu-central-1", "Frankfurt"],
  ["eu-north-1", "Stockholm"], ["ap-southeast-1", "Singapore"], ["ap-southeast-2", "Sydney"], ["ap-northeast-1", "Tokyo"],
  ["ap-south-1", "Mumbai"], ["sa-east-1", "São Paulo"],
] as const;

/**
 * Merge one step's answers into the draft. Only known fields, each checked, so a
 * body cannot plant anything else. Name and region are fixed once deployed.
 */
export function patch(d: Draft, body: Record<string, any>, encrypt: (s: string) => string): Draft {
  const deployed = !!d.deploy;
  if (Number.isInteger(body.step)) d.step = Math.max(d.step, Math.min(7, Math.max(1, body.step)));
  const c = body.connect;
  if (c && typeof c === "object") {
    if (c.mode === "profile" || c.mode === "keys") d.connect.mode = c.mode;
    if (typeof c.profile === "string") {
      const p = c.profile.trim();
      if (p && !/^[\w.@+=,-]{1,64}$/.test(p)) throw bad("A profile name is letters, digits and . _ - @ + = , only.");
      d.connect.profile = p || "default";
    }
    if (typeof c.accessKeyId === "string") {
      const k = c.accessKeyId.trim();
      if (k && !/^(AKIA|ASIA)[A-Z0-9]{12,20}$/.test(k)) throw bad("That does not look like an access key ID. They start with AKIA.");
      d.connect.accessKeyId = k;
    }
    if (typeof c.secretAccessKey === "string" && c.secretAccessKey.trim()) {
      const s = c.secretAccessKey.trim();
      if (!/^[A-Za-z0-9/+=]{30,60}$/.test(s)) throw bad("That does not look like a secret access key.");
      d.connect.secretAccessKey = encrypt(s);
    }
    // A different account or profile is a different check.
    if (c.mode || c.profile !== undefined || c.accessKeyId !== undefined || c.secretAccessKey) { d.connect.identity = null; d.connect.checked = null; }
  }
  const g = body.config;
  if (g && typeof g === "object") {
    if (typeof g.name === "string" && !deployed) {
      const n = g.name.trim().toLowerCase();
      if (!/^[a-z][a-z0-9-]{1,20}[a-z0-9]$/.test(n)) throw bad("A name is 3 to 22 lower-case letters, digits and dashes, starting with a letter. Every resource's name starts with it.");
      d.config.name = n;
    }
    if (typeof g.region === "string" && !deployed) {
      if (!REGIONS.some(([r]) => r === g.region)) throw bad("Pick a region from the list.");
      d.config.region = g.region;
    }
    if (typeof g.adminEmail === "string") {
      const e = g.adminEmail.trim();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad("That email does not look right.");
      d.config.adminEmail = e;
    }
    if (typeof g.size === "string" && SIZES.some((s) => s.id === g.size)) d.config.size = g.size as SizeId;
    if (g.storageGb !== undefined) {
      const n = Number(g.storageGb);
      if (!Number.isInteger(n) || n < 1 || n > 2000) throw bad("Storage is a whole number of GB, 1 to 2000.");
      d.config.storageGb = n;
    }
    if (g.address === "lb" || g.address === "domain") d.config.address = g.address;
    if (typeof g.domain === "string") {
      const dn = g.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      if (dn && !/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(dn)) throw bad("A domain looks like ci.example.com, with no path.");
      d.config.domain = dn;
    }
    if (typeof g.staticIp === "boolean") d.config.staticIp = g.staticIp;
  }
  const a = body.data;
  if (a && typeof a === "object") {
    if (["fresh", "move", "bundle"].includes(a.mode)) d.data.mode = a.mode;
    if (typeof a.bundlePass === "string") d.data.bundlePass = a.bundlePass ? encrypt(a.bundlePass) : "";
    if (["none", "last50", "all"].includes(a.history)) d.data.history = a.history;
    if (typeof a.pauseHere === "boolean") d.data.pauseHere = a.pauseHere;
  }
  return d;
}

/** What still stops a deploy, in the words the review step shows. Empty when it can go. */
export function missing(d: Draft): string[] {
  const out: string[] = [];
  if (!d.connect.identity) out.push("Connect an AWS account (step 2).");
  else if (d.connect.checked?.groups.some((g) => g.needed && g.denied.length)) out.push("The AWS account is missing permissions (step 2).");
  if (d.config.address === "domain" && !d.config.domain) out.push("Type the custom domain, or use the load balancer's own address (step 3).");
  if (d.data.mode === "bundle" && !d.data.bundleFile) out.push("Choose the .ezp file to start from (step 4).");
  return out;
}
