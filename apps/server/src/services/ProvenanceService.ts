import { execFileSync } from "child_process";
import * as fs from "fs";
import path from "path";
import { DatabaseService } from "./Database.js";
import Logger from "../controllers/Logger.js";

/**
 * What a run contained, and what it produced.
 *
 * Both halves have the same shape of problem: EZPIPELINE runs arbitrary shell
 * and cannot be told what a pipeline is doing. So everything here is BEST
 * EFFORT BY DESIGN - it finds what it can, records where each fact came from,
 * and never guesses. A wrong commit list or an invented image reference is
 * worse than an empty one, because somebody would roll back onto it.
 *
 * TWO WAYS TO LEARN AN ARTIFACT, and the order matters:
 *
 *   A MARKER the pipeline echoes. Explicit, exact, and always wins:
 *       echo "::ezpipeline artifact image=myreg.azurecr.io/api:abc123"
 *   RECOGNISING the builder's own output. Zero configuration, covers the
 *   common builders, and is never trusted over a marker.
 *
 * That combination is what "works for most pipelines" means in practice: a
 * pipeline that does nothing gets useful results, and a pipeline that cares
 * gets exact ones with one echo.
 */

export interface CommitInfo {
    sha: string;
    shortSha: string;
    author: string;
    date: string;
    subject: string;
}

export interface ArtifactInfo {
    reference: string;
    tag: string | null;
    digest: string | null;
    source: "marker" | "log";
}

/** Not every line of a long build log is worth scanning twice. */
const MAX_LOG_LINES = 20000;

export class ProvenanceService {
    private static instance: ProvenanceService;
    private db = DatabaseService.getInstance();
    private logger = Logger.getInstance();

    public static getInstance(): ProvenanceService {
        if (!ProvenanceService.instance) {
            ProvenanceService.instance = new ProvenanceService();
        }
        return ProvenanceService.instance;
    }

    // ── Commits ─────────────────────────────────────────────────────────────

    /**
     * The git repository this run worked in, if there is one.
     *
     * Looks at the workspace and then ONE level down, because the common shape
     * is `workspace/<repo-name>/` - a pipeline clones into a named directory
     * rather than into the workspace root. Deeper than that is guessing: a
     * `node_modules` with a vendored `.git` in it would answer, and answer
     * wrongly.
     */
    private findRepo(workspaceDir: string): string | null {
        if (!workspaceDir || !fs.existsSync(workspaceDir)) return null;
        if (fs.existsSync(path.join(workspaceDir, ".git"))) return workspaceDir;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
        } catch {
            return null;
        }
        for (const e of entries) {
            if (!e.isDirectory() || e.name === "node_modules") continue;
            const candidate = path.join(workspaceDir, e.name);
            if (fs.existsSync(path.join(candidate, ".git"))) return candidate;
        }
        return null;
    }

    private git(repo: string, args: string[]): string {
        // execFileSync with an ARRAY, never a shell string. A branch or a
        // workspace path is not ours and does not belong in a command line.
        return execFileSync("git", args, {
            cwd: repo,
            encoding: "utf8",
            timeout: 15000,
            maxBuffer: 8 * 1024 * 1024,
        }).trim();
    }

    /**
     * The commits this run contains, newest first.
     *
     * THE RANGE IS FROM THE LAST BUILD OF THE SAME PIPELINE, not from a fixed
     * depth. "What is in this run" means "what has landed since the last one",
     * and that is the question somebody looking at a failed deploy is actually
     * asking. With no previous build - or a previous sha this clone does not
     * contain, which happens after a force push or a fresh workspace - it falls
     * back to the head commit alone rather than inventing a range.
     *
     * Capped. A first run against a repository with ten years of history should
     * record a page of commits, not ten years of them.
     */
    public collectCommits(workspaceDir: string, target: string, buildId: string): {
        headSha: string | null;
        commits: CommitInfo[];
    } {
        const repo = this.findRepo(workspaceDir);
        if (!repo) return { headSha: null, commits: [] };

        let headSha: string;
        try {
            headSha = this.git(repo, ["rev-parse", "HEAD"]);
        } catch {
            // Not a usable repository. Silent: a pipeline that does not clone
            // anything is an ordinary pipeline, not a broken one.
            return { headSha: null, commits: [] };
        }

        const previous = this.db.getDb().prepare(`
            SELECT commit_sha FROM builds
             WHERE target = ? AND id != ? AND commit_sha IS NOT NULL
             ORDER BY started_at DESC LIMIT 1
        `).get(target, buildId) as { commit_sha: string } | undefined;

        const FORMAT = "%H%x1f%h%x1f%an%x1f%aI%x1f%s";
        let raw = "";
        try {
            if (previous?.commit_sha && previous.commit_sha !== headSha) {
                // Does this clone actually contain that commit? After a force
                // push it does not, and `git log A..B` would fail - or worse,
                // succeed against a different history.
                this.git(repo, ["cat-file", "-e", `${previous.commit_sha}^{commit}`]);
                raw = this.git(repo, [
                    "log", `--format=${FORMAT}`, "--max-count=50",
                    `${previous.commit_sha}..${headSha}`,
                ]);
            }
        } catch {
            raw = "";
        }
        if (!raw) {
            try {
                raw = this.git(repo, ["log", `--format=${FORMAT}`, "--max-count=1", headSha]);
            } catch {
                return { headSha, commits: [] };
            }
        }

        const commits = raw
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const [sha, shortSha, author, date, ...rest] = line.split("\x1f");
                return {
                    sha: sha ?? "",
                    shortSha: shortSha ?? "",
                    author: author ?? "",
                    date: date ?? "",
                    subject: rest.join("\x1f"),
                };
            })
            .filter((c) => c.sha);

        return { headSha, commits };
    }

    // ── Artifacts ───────────────────────────────────────────────────────────

    /**
     * Image references a builder announced, recognised from its own output.
     *
     * DELIBERATELY NARROW. Each pattern matches a line a builder prints when it
     * has actually pushed or tagged something - not any line that happens to
     * contain a colon. A loose pattern here does not produce a slightly worse
     * list, it produces a rollback target that was never a real image.
     *
     * Covered: docker push, docker build -t, buildx, `Successfully tagged`,
     * and `az acr build --image`, which is the one this instance's own
     * pipelines use.
     */
    private static readonly LOG_PATTERNS: { re: RegExp; group: number }[] = [
        // docker push registry/name:tag
        { re: /^\s*(?:\$\s*)?docker\s+(?:image\s+)?push\s+(\S+:[\w.\-]+)\s*$/i, group: 1 },
        // docker build -t name:tag  /  docker buildx build ... -t name:tag
        { re: /docker\s+(?:buildx\s+)?build\b.*?\s-t\s+(\S+:[\w.\-]+)/i, group: 1 },
        // Successfully tagged name:tag
        { re: /^\s*Successfully tagged\s+(\S+:[\w.\-]+)\s*$/i, group: 1 },
        // az acr build --image name:tag
        { re: /az\s+acr\s+build\b.*?--image\s+(\S+:[\w.\-]+)/i, group: 1 },
        // NOT `The push refers to repository [...]`. It names a repository
        // with no tag, so it can never be a rollback target, and it arrives
        // once per push - so it filled the list with entries that looked like
        // artifacts and could not be used as one.
    ];

    /**
     * Tags that move, and so cannot be rolled back TO.
     *
     * `latest` is pushed by most pipelines alongside the real tag and points
     * at whatever ran most recently - which is the thing you are trying to get
     * away from. Offering it as a rollback target is offering a button that
     * redeploys exactly what is already there.
     *
     * They are still RECORDED: the run did push them, and the record is of
     * what happened. They are only excluded from the rollback picker.
     */
    private static readonly MUTABLE_TAGS = new Set(["latest", "main", "master", "edge", "stable"]);

    public static isRollbackable(a: ArtifactInfo): boolean {
        return !!a.tag && !ProvenanceService.MUTABLE_TAGS.has(a.tag.toLowerCase());
    }

    /** `::ezpipeline artifact image=<ref> [digest=<sha256:...>]` */
    private static readonly MARKER =
        /::ezpipeline\s+artifact\s+image=(\S+?)(?:\s+digest=(sha256:[0-9a-f]+))?\s*$/i;

    /**
     * A digest is only ever taken from a MARKER, never from the log.
     *
     * The first version tracked the most recent `digest:` line and attached it
     * to whatever reference came next. Measured against a real build and it is
     * unsound: this pipeline builds two images CONCURRENTLY, their output
     * interleaves, and one digest - sha256:c610... - appeared inside both the
     * api and the web sections. Proximity is not association.
     *
     * A tag with no digest is honest and still rolls back. A tag with the
     * WRONG digest is a rollback onto somebody else's image, and nothing about
     * it would look wrong on the screen.
     */

    /**
     * Read a build's own log back and work out what it produced.
     *
     * Reading the LOG rather than hooking the stream: a step can shell out to
     * anything, and the log is the one place every builder's output already
     * arrives. It also means this works on a build that has already finished,
     * which is what makes it possible to fill in history later.
     */
    public detectArtifacts(entries: string[]): ArtifactInfo[] {
        const byRef = new Map<string, ArtifactInfo>();

        // SPLIT, because a "log entry" is not a line. build_logs rows hold
        // whatever a step wrote in one go, and a step that echoes its own
        // script stores the entire script as ONE row - so every anchored
        // pattern below matched nothing at all.
        //
        // Found by running this against a real successful deploy that had
        // plainly built two images and getting zero results back. Nothing
        // about the patterns was wrong; they were being asked about the wrong
        // unit of text.
        const lines: string[] = [];
        for (const entry of entries) {
            for (const line of String(entry ?? "").split("\n")) {
                lines.push(line);
                if (lines.length >= MAX_LOG_LINES) break;
            }
            if (lines.length >= MAX_LOG_LINES) break;
        }

        for (const line of lines) {
            const m = ProvenanceService.MARKER.exec(line);
            if (m?.[1]) {
                // A MARKER ALWAYS WINS, including over a marker-less entry we
                // already recorded for the same reference from a log pattern.
                byRef.set(m[1], {
                    reference: m[1],
                    tag: ProvenanceService.tagOf(m[1]),
                    digest: m[2] ?? null,
                    source: "marker",
                });
                continue;
            }

            for (const { re, group } of ProvenanceService.LOG_PATTERNS) {
                const hit = re.exec(line);
                const ref = hit?.[group];
                if (!ref || !ProvenanceService.plausible(ref)) continue;
                if (byRef.get(ref)?.source === "marker") break;
                byRef.set(ref, {
                    reference: ref,
                    tag: ProvenanceService.tagOf(ref),
                    digest: null,
                    source: "log",
                });
                break;
            }
        }
        return [...byRef.values()];
    }

    private static tagOf(reference: string): string | null {
        // The LAST colon, and only if what follows has no slash in it -
        // `host:5000/name` is a port, not a tag, and splitting on the first
        // colon would record the port as the version.
        const i = reference.lastIndexOf(":");
        if (i < 0) return null;
        const tail = reference.slice(i + 1);
        return tail.includes("/") || tail === "" ? null : tail;
    }

    /**
     * Refuse things that matched a pattern but cannot be an image.
     *
     * The patterns are narrow, and this is the second line: a shell variable
     * that was never expanded is the one that would actually get recorded, and
     * `notchfm-api:$TAG` as a rollback target is a trap rather than a typo.
     */
    private static plausible(reference: string): boolean {
        if (reference.length > 400) return false;
        if (/[$`"'\\]/.test(reference)) return false;
        if (reference.includes("*")) return false;
        return /^[A-Za-z0-9][A-Za-z0-9._\-/:]*$/.test(reference);
    }

    // ── Writing it down ─────────────────────────────────────────────────────

    public saveCommits(buildId: string, headSha: string | null, commits: CommitInfo[]): void {
        try {
            this.db.getDb().prepare(
                `UPDATE builds SET commit_sha = ?, commits = ? WHERE id = ?`
            ).run(headSha, commits.length ? JSON.stringify(commits) : null, buildId);
        } catch (e) {
            // Provenance is a record ABOUT a build, never part of it. A failure
            // here must not touch the build's own outcome.
            this.logger.error("failed to record commits", e as Error);
        }
    }

    public saveArtifacts(buildId: string, target: string, artifacts: ArtifactInfo[]): void {
        if (artifacts.length === 0) return;
        try {
            const db = this.db.getDb();
            const insert = db.prepare(`
                INSERT INTO build_artifacts (build_id, target, kind, reference, tag, digest, source)
                VALUES (?, ?, 'image', ?, ?, ?, ?)
            `);
            db.transaction(() => {
                db.prepare(`DELETE FROM build_artifacts WHERE build_id = ?`).run(buildId);
                for (const a of artifacts) {
                    insert.run(buildId, target, a.reference, a.tag, a.digest, a.source);
                }
            })();
        } catch (e) {
            this.logger.error("failed to record artifacts", e as Error);
        }
    }

    public artifactsFor(buildId: string): ArtifactInfo[] {
        try {
            return this.db.getDb().prepare(`
                SELECT reference, tag, digest, source FROM build_artifacts
                 WHERE build_id = ? ORDER BY id
            `).all(buildId) as ArtifactInfo[];
        } catch {
            return [];
        }
    }

    public commitsFor(raw: string | null): CommitInfo[] {
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
}
