/**
 * Talking to AWS before anything is made: who the sign-in is, what it may do, and
 * whether the region can take a deploy. Uses the AWS CLI (the plugin, or one on the
 * PATH), with the draft's profile or pasted key in its environment and nowhere else.
 */
import { execFile } from "child_process";
import path from "path";
import { PluginManager } from "../PluginManager.js";
import { decryptCredential } from "../gitCredentials.js";
import { permissionGroups } from "./aws.js";
import type { Check, Draft } from "./store.js";

export type Run = (args: string[], env: Record<string, string>) => Promise<{ ok: boolean; out: string; err: string; missing?: boolean }>;

/** The real AWS CLI. Tests pass their own. */
export const awsCli: Run = (args, env) => new Promise((resolve) => {
  let paths: string[] = [];
  try { paths = PluginManager.getInstance().getPluginBinPaths(); } catch { /* no plugins yet */ }
  const PATH = [...paths, process.env.PATH ?? ""].join(path.delimiter);
  execFile("aws", [...args, "--output", "json"], { env: { ...process.env, PATH, AWS_PAGER: "", ...env }, timeout: 45_000, maxBuffer: 8 << 20 }, (e, out, err) => {
    const code = (e as NodeJS.ErrnoException | null)?.code;
    resolve({ ok: !e, out: String(out), err: String(err).trim() || (e ? e.message : ""), missing: code === "ENOENT" });
  });
});

/** The sign-in's environment: a profile, or the pasted key. */
export function credsEnv(d: Draft): Record<string, string> {
  const base: Record<string, string> = { AWS_REGION: d.config.region, AWS_DEFAULT_REGION: d.config.region };
  if (d.connect.mode === "profile") return { ...base, AWS_PROFILE: d.connect.profile || "default" };
  const secret = d.connect.secretAccessKey ? decryptCredential(d.connect.secretAccessKey) : null;
  // Unset the profile so a default one on the host cannot stand in for the pasted key.
  return { ...base, AWS_PROFILE: "", AWS_ACCESS_KEY_ID: d.connect.accessKeyId, AWS_SECRET_ACCESS_KEY: secret ?? "" };
}

const NO_CLI = "The AWS CLI is not installed here. Install the AWS CLI plugin in Settings, Plugins, then check again.";

/** AWS's own message, without the CLI's "An error occurred (X) when calling the Y operation:" preamble kept twice. */
export function awsMessage(err: string): string {
  const m = /An error occurred \(([^)]+)\)[^:]*:\s*([\s\S]*)/.exec(err);
  return (m ? `${m[2].trim()} (${m[1]})` : err.trim()).split("\n")[0].slice(0, 400);
}

export async function profiles(run: Run = awsCli): Promise<{ profiles: string[]; cli: boolean }> {
  const r = await run(["configure", "list-profiles"], {});
  if (r.missing) return { profiles: [], cli: false };
  // list-profiles ignores --output json and prints one per line.
  return { profiles: r.ok ? r.out.split("\n").map((x) => x.trim()).filter(Boolean) : [], cli: true };
}

export interface Identity { arn: string; account: string; name: string; expires: string | null }

export async function identity(d: Draft, run: Run = awsCli): Promise<{ identity?: Identity; error?: string }> {
  if (d.connect.mode === "keys" && (!d.connect.accessKeyId || !d.connect.secretAccessKey)) return { error: "Paste the access key ID and the secret access key." };
  const r = await run(["sts", "get-caller-identity"], credsEnv(d));
  if (r.missing) return { error: NO_CLI };
  if (!r.ok) {
    const msg = awsMessage(r.err);
    if (/could not be found|ProfileNotFound/i.test(r.err)) return { error: `There is no AWS CLI profile called "${d.connect.profile}" on this instance. Pick another, or paste an access key.` };
    if (/Unable to locate credentials/i.test(r.err)) return { error: `The profile "${d.connect.profile}" has no credentials. Run aws configure (or aws sso login) on this instance, or paste an access key.` };
    if (/expired|ExpiredToken/i.test(r.err)) return { error: `The sign-in for "${d.connect.profile}" has expired. Run aws sso login --profile ${d.connect.profile} on this instance, then check again.` };
    return { error: `AWS did not accept the sign-in: ${msg}` };
  }
  const j = JSON.parse(r.out) as { Arn: string; Account: string };
  const name = j.Arn.endsWith(":root") ? "root" : j.Arn.split("/").slice(-1)[0];
  let expires: string | null = null;
  if (d.connect.mode === "profile") {
    // Temporary credentials (SSO, assumed roles) say when they end; long-lived keys do not.
    const e = await run(["configure", "export-credentials", "--format", "process"], credsEnv(d));
    if (e.ok) { try { expires = JSON.parse(e.out).Expiration ?? null; } catch { /* older CLI */ } }
  }
  return { identity: { arn: j.Arn, account: j.Account, name: j.Arn.includes(":assumed-role/") ? j.Arn.split("/")[1] : name, expires } };
}

/**
 * The ARN IAM's policy simulator takes. An assumed role's session ARN is turned
 * back into the role's own (asking IAM for it, since a role's path is not in the
 * session ARN).
 */
async function principal(arn: string, d: Draft, run: Run): Promise<string> {
  const m = /^arn:aws:sts::(\d+):assumed-role\/([^/]+)\//.exec(arn);
  if (!m) return arn;
  const r = await run(["iam", "get-role", "--role-name", m[2]], credsEnv(d));
  if (r.ok) { try { return JSON.parse(r.out).Role.Arn; } catch { /* fall through */ } }
  return `arn:aws:iam::${m[1]}:role/${m[2]}`;
}

/** Ask IAM's policy simulator about every action the deploy calls. */
export async function checkPermissions(d: Draft, id: Identity, run: Run = awsCli): Promise<Check> {
  const groups = permissionGroups(d).map((g) => ({ ...g, denied: [] as string[] }));
  const at = new Date().toISOString();
  if (id.arn.endsWith(":root")) {
    return { at, groups, error: null, note: "This is the account's root user, which may do everything. AWS advises a separate IAM user or role for this; it works either way." };
  }
  const who = await principal(id.arn, d, run);
  const actions = [...new Set(groups.flatMap((g) => g.actions))];
  const denied = new Set<string>();
  // The simulator takes a limited number of actions per call.
  for (let i = 0; i < actions.length; i += 40) {
    const r = await run(["iam", "simulate-principal-policy", "--policy-source-arn", who, "--action-names", ...actions.slice(i, i + 40)], credsEnv(d));
    if (!r.ok) {
      const msg = awsMessage(r.err);
      const self = /SimulatePrincipalPolicy/.test(r.err) && /AccessDenied|not authorized/i.test(r.err);
      return {
        at, groups, note: null,
        error: self
          ? `${id.name} may not use IAM's policy simulator (iam:SimulatePrincipalPolicy), so the permissions could not be checked. Add that action, or deploy anyway: a missing permission then stops the deploy at the step that needs it, and it can be retried from there.`
          : `The permissions could not be checked: ${msg}`,
      };
    }
    for (const e of (JSON.parse(r.out).EvaluationResults ?? []) as { EvalActionName: string; EvalDecision: string }[]) {
      if (e.EvalDecision !== "allowed") denied.add(e.EvalActionName);
    }
  }
  for (const g of groups) g.denied = g.actions.filter((a) => denied.has(a));
  return { at, groups, note: null, error: null };
}

/**
 * What in the region would stop a deploy before it starts: no default VPC, or
 * too few Elastic IPs left for static addresses.
 */
export async function regionBlockers(d: Draft, run: Run = awsCli): Promise<string[]> {
  const out: string[] = [];
  const env = credsEnv(d);
  const v = await run(["ec2", "describe-vpcs", "--filters", "Name=isDefault,Values=true"], env);
  if (v.missing) return [NO_CLI];
  if (!v.ok) return [`Could not look at the region's network: ${awsMessage(v.err)}`];
  const vpcs = (JSON.parse(v.out).Vpcs ?? []) as { VpcId: string }[];
  if (!vpcs.length) {
    out.push(`${d.config.region} has no default VPC, which the deploy uses. Make one with: aws ec2 create-default-vpc --region ${d.config.region}`);
  } else {
    const s = await run(["ec2", "describe-subnets", "--filters", `Name=vpc-id,Values=${vpcs[0].VpcId}`, "Name=default-for-az,Values=true"], env);
    if (s.ok && ((JSON.parse(s.out).Subnets ?? []) as unknown[]).length < 2) {
      out.push(`The default VPC in ${d.config.region} has fewer than 2 default subnets, and the load balancer needs two zones. Make the missing one with: aws ec2 create-default-subnet --availability-zone <zone>`);
    }
  }
  if (d.config.staticIp) {
    const a = await run(["ec2", "describe-addresses"], env);
    const q = await run(["service-quotas", "get-service-quota", "--service-code", "ec2", "--quota-code", "L-0263D0A3"], env);
    if (a.ok) {
      const used = ((JSON.parse(a.out).Addresses ?? []) as unknown[]).length;
      let limit = 5;
      if (q.ok) { try { limit = Math.floor(JSON.parse(q.out).Quota.Value) || 5; } catch { /* default */ } }
      if (used + 2 > limit) {
        out.push(`Static IP addresses need 2 Elastic IPs, and ${d.config.region} has ${used} of its ${limit} in use. Release ${used + 2 - limit} you no longer use, ask AWS for a higher limit (Service Quotas, EC2-VPC Elastic IPs), or turn off static IP addresses.`);
      }
    }
  }
  return out;
}
