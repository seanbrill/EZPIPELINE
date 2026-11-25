/**
 * First-run setup and the Getting started checklist (design sheet f7–f17).
 *
 * Setup is seven steps, and the wizard saves after each one, so closing the
 * tab halfway picks up where it stopped. The answers live in one settings row
 * as JSON. Nothing secret is in it: the admin's password goes straight into
 * the users table, and a deploy key's private half never leaves its own table.
 */
import { execFile } from "child_process";
import os from "os";
import { DatabaseService } from "./Database.js";
import { SettingsService } from "./SettingsService.js";

export type Theme = "classic" | "midnight" | "light";
export interface SetupState {
  /** The furthest step reached, 1 to 7. */
  step: number;
  done: boolean;
  acknowledged: boolean;
  instance: { name: string; url: string; theme: Theme };
  /** Plugin ids picked in step 5, to say on step 7 what was asked for. */
  plugins: string[];
  firstPipeline: string | null;
}

const KEY = "setup";
const DEFAULT: SetupState = {
  step: 1, done: false, acknowledged: false,
  instance: { name: "EZPipeline", url: "", theme: "classic" },
  plugins: [], firstPipeline: null,
};
const THEMES: Theme[] = ["classic", "midnight", "light"];

/**
 * `legacy` is for reading only: a write must not take the "already set up"
 * answer, or the first save after creating the admin would mark setup done.
 */
export function readSetup(legacy = true): SetupState {
  try {
    const raw = SettingsService.getInstance().get(KEY);
    if (!raw && !legacy) return structuredClone(DEFAULT);
    // No record but people already sign in: an instance from before setup
    // existed. It is set up; sending its admin through a wizard would be wrong.
    if (!raw) return { ...structuredClone(DEFAULT), ...(DatabaseService.getInstance().hasUsers() ? { done: true, step: 7, acknowledged: true } : {}) };
    const v = JSON.parse(raw);
    return { ...structuredClone(DEFAULT), ...v, instance: { ...DEFAULT.instance, ...(v.instance ?? {}) } };
  } catch {
    return structuredClone(DEFAULT);
  }
}

/** Merge a step's answers. Only known fields, each checked, so a body cannot plant anything else. */
/**
 * `fresh` only from creating the first admin: then the users table is no
 * longer empty, and the "set up before setup existed" reading would mark it done.
 */
export function writeSetup(patch: Record<string, unknown>, { fresh = false } = {}): SetupState {
  const s = readSetup(!fresh);
  if (typeof patch.step === "number" && Number.isInteger(patch.step)) s.step = Math.max(s.step, Math.min(7, Math.max(1, patch.step)));
  if (patch.done === true) { s.done = true; s.step = 7; }
  // Settings › General › Run setup again: every step opens with what is set now.
  if (patch.rerun === true) s.done = false;
  if (patch.acknowledged === true) s.acknowledged = true;
  const inst = patch.instance as Record<string, unknown> | undefined;
  if (inst && typeof inst === "object") {
    if (typeof inst.name === "string") {
      const n = inst.name.trim().slice(0, 60);
      if (!n) throw Object.assign(new Error("Give the instance a name."), { status: 400 });
      s.instance.name = n;
    }
    if (typeof inst.url === "string") {
      const u = inst.url.trim().replace(/\/+$/, "");
      if (u && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(u)) throw Object.assign(new Error("The URL should start with https:// or http://"), { status: 400 });
      s.instance.url = u;
    }
    if (typeof inst.theme === "string" && (THEMES as string[]).includes(inst.theme)) s.instance.theme = inst.theme as Theme;
  }
  if (Array.isArray(patch.plugins)) s.plugins = patch.plugins.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,40}$/.test(x)).slice(0, 30);
  if (typeof patch.firstPipeline === "string") s.firstPipeline = patch.firstPipeline.slice(0, 200);
  SettingsService.getInstance().set(KEY, JSON.stringify(s));
  return s;
}

/** What the sign-in page may show anyone: the name and the default theme. */
export function publicInstance() {
  const s = readSetup();
  // app and version let the desktop app's Connect screen tell an EZPipeline from any other page.
  return { app: "ezpipeline", name: s.instance.name, theme: s.instance.theme, version: process.env.EZP_VERSION ?? process.env.npm_package_version ?? null };
}

let dockerCache: { at: number; value: string | null } | null = null;
function dockerVersion(): Promise<string | null> {
  if (dockerCache && Date.now() - dockerCache.at < 60_000) return Promise.resolve(dockerCache.value);
  return new Promise((resolve) => {
    execFile("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 3000 }, (err, out) => {
      const v = err ? null : String(out).trim() || null;
      dockerCache = { at: Date.now(), value: v };
      resolve(v);
    });
  });
}

/** The line under step 1: what this host is, so "steps run on this host" means something. */
export async function hostFacts(dataDir: string) {
  return { platform: `${os.platform()}/${os.arch()}`, docker: await dockerVersion(), dataDir };
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export interface Template {
  id: string;
  name: string;
  steps: string[];
  /** A plugin the template's steps call, or a tool in the image. */
  needs: { plugin?: string; builtin?: string };
  yaml: (o: { id: string; name: string; author: string }) => string;
}

const q = (s: string) => JSON.stringify(s);
const head = (o: { id: string; name: string; author: string }, description: string) =>
  `id: ${q(o.id)}\nappName: ${q(o.name)}\nversion: "1.0.0"\ndescription: ${q(description)}\n\nsteps:\n`;

export const TEMPLATES: Template[] = [
  {
    id: "static-site", name: "Static site → FileFreak Sites", steps: ["Preflight", "Install", "Build", "Deploy", "Verify"], needs: { plugin: "filefreak" },
    yaml: (o) => head(o, "Build a static site and deploy it to FileFreak Sites.") +
`  - name: Preflight
    run: |
      filefreak --version
      test -n "$FILEFREAK_KEY" || { echo "Add FILEFREAK_KEY as a secret in Environment."; exit 1; }
  - name: Install
    run: npm ci
  - name: Build
    run: npm run build
  - name: Deploy
    run: filefreak sites deploy dist --site "$SITE"
  - name: Verify
    run: curl -fsS "https://$SITE.filefreak.page" > /dev/null
`,
  },
  {
    id: "node-ssh", name: "Node.js app over SSH", steps: ["Install", "Test", "Build", "Copy", "Restart"], needs: { builtin: "Node.js and SSH" },
    yaml: (o) => head(o, "Test and build a Node.js app, copy it to a server and restart it.") +
`  - name: Install
    run: npm ci
  - name: Test
    run: npm test
  - name: Build
    run: npm run build
  - name: Copy
    run: rsync -az --delete -e "ssh -i $RESOURCES/deploy.pem -o StrictHostKeyChecking=accept-new" dist/ "$DEPLOY_HOST:/srv/app/"
  - name: Restart
    run: ssh -i "$RESOURCES/deploy.pem" "$DEPLOY_HOST" "sudo systemctl restart app"
`,
  },
  {
    id: "docker", name: "Docker image, build and push", steps: ["Build", "Tag", "Push"], needs: { builtin: "Docker" },
    yaml: (o) => head(o, "Build a Docker image and push it to a registry.") +
`  - name: Build
    run: docker build -t "$IMAGE:$BUILD_ID" .
  - name: Tag
    run: docker tag "$IMAGE:$BUILD_ID" "$IMAGE:latest"
  - name: Push
    run: |
      docker push "$IMAGE:$BUILD_ID"
      docker push "$IMAGE:latest"
`,
  },
  {
    id: "terraform", name: "Terraform: plan, approve, apply", steps: ["Init", "Plan", "Approval gate", "Apply"], needs: { plugin: "terraform" },
    yaml: (o) => head(o, "Plan a Terraform change, wait for someone to approve it, then apply it.") +
`  - name: Init
    run: terraform init -input=false
  - name: Plan
    run: terraform plan -input=false -out=tfplan
  - name: Approve the plan
    type: approval
  - name: Apply
    run: terraform apply -input=false tfplan
`,
  },
  {
    id: "blank", name: "Blank pipeline", steps: ['echo "hello from EZPipeline"'], needs: {},
    yaml: (o) => head(o, "A pipeline to start from.") +
`  - name: Hello
    run: echo "hello from EZPipeline"
`,
  },
];

/** A pipeline or group name: letters, digits, spaces, dots, dashes, underscores. Never a path. */
export function safeName(name: unknown, what = "name"): string {
  const n = String(name ?? "").trim();
  if (!n) throw Object.assign(new Error(`Give it a ${what}.`), { status: 400 });
  if (n.length > 80 || !/^[\w][\w .-]*$/.test(n) || n.includes("..")) {
    throw Object.assign(new Error(`A ${what} can use letters, digits, spaces, dots, dashes and underscores.`), { status: 400 });
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Getting started                                                     */
/* ------------------------------------------------------------------ */

export interface ChecklistItem { id: string; done: boolean; detail?: string }

/**
 * The checklist on the Overview (f16). Every item is read from what is really
 * there, not ticked by the wizard, so a key deleted later un-ticks "Connect git".
 */
export function checklist(input: { pipelines: { id: string; appName: string }[]; installedPlugins: string[] }): ChecklistItem[] {
  const db = DatabaseService.getInstance().getDb();
  const one = <T>(sql: string): T | undefined => { try { return db.prepare(sql).get() as T | undefined; } catch { return undefined; } };
  const admin = one<{ username: string; mfa_enabled: number }>(`SELECT username, mfa_enabled FROM users WHERE is_primary_admin = 1 LIMIT 1`);
  const keys = one<{ n: number; can: number }>(`SELECT COUNT(*) n, SUM(CASE WHEN test_can_read = 1 THEN 1 ELSE 0 END) can FROM git_credentials`);
  const runs = one<{ n: number }>(`SELECT COUNT(*) n FROM builds`);
  const watches = one<{ n: number }>(`SELECT COUNT(*) n FROM git_watches`);
  const users = one<{ n: number }>(`SELECT COUNT(*) n FROM users`);
  const first = input.pipelines[0];
  return [
    { id: "admin", done: !!admin, detail: admin ? `${admin.username}${admin.mfa_enabled ? " · MFA on" : ""}` : undefined },
    { id: "git", done: (keys?.n ?? 0) > 0, detail: keys?.n ? `${keys.n} deploy key${keys.n === 1 ? "" : "s"}${keys.can ? " · can read" : ""}` : undefined },
    { id: "plugins", done: input.installedPlugins.length > 0, detail: input.installedPlugins.slice(0, 3).join(", ") || undefined },
    { id: "pipeline", done: input.pipelines.length > 0, detail: first?.appName },
    { id: "run", done: (runs?.n ?? 0) > 0 },
    { id: "watch", done: (watches?.n ?? 0) > 0 },
    { id: "teammate", done: (users?.n ?? 0) > 1 },
  ];
}
