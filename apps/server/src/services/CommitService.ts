/**
 * Commit details from a bare cache clone, so a run can show what it contains
 * BEFORE it starts.
 *
 * A run only knew its commits after it had cloned and finished, and only if it
 * succeeded; a watch knew nothing but a sha from `ls-remote`. So a queued or
 * failed run could say "main@a899a9d" and nothing else, which is exactly when
 * someone wants to know what it was.
 *
 * Each watched repository gets one bare, blob-less clone under
 * data/git-cache/. Fetching it is cheap (commits and trees, no file contents),
 * and `--shortstat` fetches the few blobs it needs on demand.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { DATA_DIR } from "../config/index.js";
import { DatabaseService } from "./Database.js";
import { readAccessForGroup } from "./gitCredentials.js";

const execFileAsync = promisify(execFile);

export interface CommitDetails {
  sha: string;
  shortSha: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  body: string;
  files: number | null;
  insertions: number | null;
  deletions: number | null;
}

const RS = "\x1e";
const US = "\x1f";
/** Record separator first, so a multi-line body cannot be mistaken for the next commit. */
export const LOG_FORMAT = `--format=${"%x1e"}%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%b%x1f`;

/** " 3 files changed, 10 insertions(+), 2 deletions(-)" → numbers. Any part may be missing. */
export function parseShortstat(text: string): { files: number | null; insertions: number | null; deletions: number | null } {
  const m = (re: RegExp) => {
    const r = re.exec(text);
    return r ? Number(r[1]) : null;
  };
  const files = m(/(\d+) files? changed/);
  return {
    files,
    insertions: m(/(\d+) insertions?\(\+\)/) ?? (files !== null ? 0 : null),
    deletions: m(/(\d+) deletions?\(-\)/) ?? (files !== null ? 0 : null),
  };
}

/** Output of `git log --shortstat LOG_FORMAT` → commits, newest first as git printed them. */
export function parseLog(raw: string): CommitDetails[] {
  return raw
    .split(RS)
    .filter((r) => r.trim())
    .map((rec) => {
      const [sha, parents, author, date, subject, body, stat = ""] = rec.split(US);
      return {
        sha: sha.trim(),
        shortSha: sha.trim().slice(0, 7),
        parents: (parents ?? "").trim().split(/\s+/).filter(Boolean),
        author: author ?? "",
        date: date ?? "",
        subject: subject ?? "",
        body: (body ?? "").trim(),
        ...parseShortstat(stat),
      };
    })
    .filter((c) => /^[0-9a-f]{40}$/i.test(c.sha));
}

export class CommitService {
  private static instance: CommitService;
  public static getInstance(): CommitService {
    if (!CommitService.instance) CommitService.instance = new CommitService();
    return CommitService.instance;
  }

  /** One fetch per repository at a time; a second caller waits for the first. */
  private inflight = new Map<string, Promise<string>>();

  public static cacheDir(repoUrl: string): string {
    const h = crypto.createHash("sha256").update(repoUrl).digest("hex").slice(0, 20);
    return path.join(DATA_DIR, "git-cache", `${h}.git`);
  }

  private async git(args: string[], cwd: string | undefined, group: string | null | undefined, timeout = 120_000): Promise<string> {
    const read = readAccessForGroup(group);
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
        ...(read.command ? { GIT_SSH_COMMAND: read.command } : {}),
      },
    });
    return stdout;
  }

  /** Clone or update the cache for a repository; resolves to its directory. */
  public sync(repoUrl: string, group?: string | null): Promise<string> {
    const dir = CommitService.cacheDir(repoUrl);
    const running = this.inflight.get(dir);
    if (running) return running;
    const p = (async () => {
      if (!fs.existsSync(path.join(dir, "HEAD"))) {
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        fs.rmSync(dir, { recursive: true, force: true });
        await this.git(["clone", "--bare", "--filter=blob:none", "--no-tags", repoUrl, dir], undefined, group, 600_000);
      } else {
        await this.git(["fetch", "--prune", "--filter=blob:none", "--no-tags", "origin", "+refs/heads/*:refs/heads/*"], dir, group);
      }
      return dir;
    })().finally(() => this.inflight.delete(dir));
    this.inflight.set(dir, p);
    return p;
  }

  public cached(repoUrl: string, sha: string): CommitDetails | null {
    const r = DatabaseService.getInstance().getDb()
      .prepare(`SELECT * FROM commits WHERE repo = ? AND sha = ?`).get(repoUrl, sha) as any;
    if (!r) return null;
    return {
      sha: r.sha, shortSha: r.sha.slice(0, 7), parents: r.parents ? r.parents.split(" ") : [], author: r.author ?? "",
      date: r.authored_at ?? "", subject: r.subject, body: r.body ?? "", files: r.files, insertions: r.insertions, deletions: r.deletions,
    };
  }

  private store(repoUrl: string, commits: CommitDetails[]) {
    const ins = DatabaseService.getInstance().getDb().prepare(`
      INSERT OR REPLACE INTO commits (repo, sha, subject, body, author, authored_at, files, insertions, deletions, parents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const c of commits) ins.run(repoUrl, c.sha, c.subject, c.body, c.author, c.date, c.files, c.insertions, c.deletions, c.parents.join(" "));
  }

  /**
   * The commits in `from..to`, newest first, at most `max`. With no `from`
   * (or one the cache does not have, after a force-push) just `to` itself.
   */
  public async range(repoUrl: string, from: string | null, to: string, group?: string | null, max = 50): Promise<CommitDetails[]> {
    const dir = await this.sync(repoUrl, group);
    let spec = to;
    if (from && from !== to) {
      try {
        await this.git(["cat-file", "-e", `${from}^{commit}`], dir, group, 10_000);
        spec = `${from}..${to}`;
      } catch { /* unknown base: fall back to the head alone */ }
    }
    const raw = await this.git(["log", "--shortstat", LOG_FORMAT, `--max-count=${from && spec !== to ? max : 1}`, spec], dir, group);
    const commits = parseLog(raw);
    this.store(repoUrl, commits);
    return commits;
  }

  /** One commit, from the table if it is there. */
  public async resolve(repoUrl: string, sha: string, group?: string | null): Promise<CommitDetails | null> {
    return this.cached(repoUrl, sha) ?? (await this.range(repoUrl, null, sha, group))[0] ?? null;
  }

  /**
   * Stamp a build with the commit it is expected to build, at the moment it
   * starts. Provenance replaces this with what was actually checked out when
   * the run finishes; until then a queued, running or failed run still knows.
   */
  public attachToBuild(buildId: string, sha: string, commits: CommitDetails[]) {
    DatabaseService.getInstance().getDb()
      .prepare(`UPDATE builds SET commit_sha = ?, commits = COALESCE(?, commits) WHERE id = ?`)
      .run(sha, commits.length ? JSON.stringify(commits) : null, buildId);
  }
}

/**
 * Which of `log` (newest first) are not yet deployed: everything above the
 * last deployed sha. If that sha is not in the list at all, the whole list is
 * pending (the deploy is older than the window, or history was rewritten).
 */
export function pendingFrom<T extends { sha: string }>(log: T[], deployedSha: string | null): T[] {
  if (!deployedSha) return log;
  const i = log.findIndex((c) => c.sha === deployedSha || c.sha.startsWith(deployedSha));
  return i === -1 ? log : log.slice(0, i);
}
