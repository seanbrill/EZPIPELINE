import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

/**
 * Migration: what a run was MADE OF, and what it PRODUCED.
 *
 * Two questions a build row could not answer, and they are the same question
 * asked from either end:
 *
 *   WHAT WENT IN   Which commits does this run contain? The dashboard could
 *                  show `git watch main@a899a9d` and nothing else, so a run
 *                  that deployed nine commits looked exactly like one that
 *                  deployed a typo fix, and "what shipped on Tuesday" had to
 *                  be answered by reading the repository instead.
 *
 *   WHAT CAME OUT  Which images did it build? Nothing recorded them at all.
 *                  EZPIPELINE ran the build, watched the tags scroll past in
 *                  the log, and kept none of them - so rolling back meant
 *                  finding a tag by hand in a registry, if you could remember
 *                  which registry.
 *
 * WHY ARTIFACTS ARE A TABLE AND COMMITS ARE A COLUMN. A commit list belongs to
 * exactly one build and is only ever read whole, which is what `step_timings`
 * already does as JSON. An artifact is looked up the other way round - "which
 * build produced this tag", "what is the newest image for this pipeline" - and
 * those are queries, not a blob to parse.
 *
 * NOTHING IS BACKFILLED. Past runs genuinely do not know what they contained
 * or produced, and inventing it would be the same untruth migration 009 exists
 * to remove: a row that always said "manual" read as a fact.
 */
export function migrateBuildProvenance() {
    const db = DatabaseService.getInstance().getDb();
    const logger = Logger.getInstance();

    try {
        const cols = db.prepare(`PRAGMA table_info(builds)`).all() as { name: string }[];

        if (!cols.some(c => c.name === "commit_sha")) {
            // The head this run was built at. Separate from the JSON below so
            // the NEXT run can ask "what did the last one build" in SQL, which
            // is how the commit range is computed without a working copy.
            db.exec(`ALTER TABLE builds ADD COLUMN commit_sha TEXT`);
            logger.info("✅ builds.commit_sha column added");
        }

        if (!cols.some(c => c.name === "commits")) {
            db.exec(`ALTER TABLE builds ADD COLUMN commits TEXT`);
            logger.info("✅ builds.commits column added");
        }

        const hasArtifacts = db.prepare(`
            SELECT name FROM sqlite_master WHERE type='table' AND name='build_artifacts'
        `).get();

        if (!hasArtifacts) {
            db.exec(`
                CREATE TABLE build_artifacts (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    build_id    TEXT NOT NULL,
                    target      TEXT NOT NULL,
                    /** 'image' today. Named rather than assumed, so a pipeline
                     *  that produces something else later is a new value here
                     *  and not a second table. */
                    kind        TEXT NOT NULL DEFAULT 'image',
                    /** The full reference as it was pushed: registry/name:tag.
                     *  Stored whole because that string IS the address - split
                     *  into parts it has to be reassembled correctly by every
                     *  reader, and one of them will get it wrong. */
                    reference   TEXT NOT NULL,
                    /** The tag alone, for the common case where one tag names
                     *  every image a run produced and a rollback pins it. */
                    tag         TEXT,
                    /** sha256:..., when the builder printed one. A tag can be
                     *  moved; a digest cannot, so a rollback that has one is
                     *  rolling back to a thing rather than to a name. */
                    digest      TEXT,
                    /** 'marker' when the pipeline declared it, 'log' when we
                     *  recognised it in the output. A reader deciding whether
                     *  to trust a reference needs to know which. */
                    source      TEXT NOT NULL,
                    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
                )
            `);
            // Deleting a build deletes its artifacts, and the index is on the
            // two reads that exist: one build's artifacts, and a pipeline's
            // recent ones for the rollback picker.
            db.exec(`CREATE INDEX build_artifacts_build_idx ON build_artifacts(build_id)`);
            db.exec(`CREATE INDEX build_artifacts_target_idx ON build_artifacts(target, created_at DESC)`);
            logger.info("✅ build_artifacts table created");
        }

        return true;
    } catch (error) {
        logger.error("❌ build provenance migration failed", error);
        throw error;
    }
}
