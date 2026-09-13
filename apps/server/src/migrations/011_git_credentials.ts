// Git credentials you can see, set and TEST, per group.
//
// THE INCIDENT THIS COMES FROM. The "Promote to production" button failed with
// "the key you are authenticating with has been marked as read only", and the
// operator's reply was the finding: "not even sure how the git credentials
// were set for ezpipeline". There was nowhere to look. The credential was an
// SSH key in a Docker volume, mentioned on no screen, and its permissions
// lived on GitHub rather than here.
//
// It had been read-only since it was created, and nothing noticed for months,
// because every git operation EZPIPELINE performs is a READ: ls-remote for a
// watch, fetch for a checkout, fetch for the merge's own FETCH_HEAD. The merge
// is the first and only WRITE the product has ever attempted. It was always
// going to fail the first time it ran.
//
// So the table carries the test result as well as the secret. A credential
// that has never been tested for the permission it will need is exactly the
// bug above, restated.
//
// SCOPE IS THE GROUP, matching routes/groupEnv.ts: "somebody trusted with
// FileFreak's credentials is not thereby trusted with notch.fm's, and a single
// permission covering both would make this scoping cosmetic." That argument is
// stronger for a credential than for an environment variable.

import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

export function migrateGitCredentials(): boolean {
  const db = DatabaseService.getInstance().getDb();
  const logger = Logger.getInstance();

  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='git_credentials'`)
      .get();
    if (exists) return true;

    logger.info("Creating git_credentials table...");
    db.exec(`
      CREATE TABLE git_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        -- The group this credential belongs to. Permissions ride on this, the
        -- same way they do for group environment variables.
        group_path TEXT NOT NULL,
        -- What an operator calls it in the list. Not the secret, not derived
        -- from it: "notch.fm deploy key" is the thing somebody recognises.
        name TEXT NOT NULL,
        -- 'ssh_key' or 'token'. Two shapes, because GitHub deploy keys and
        -- fine-grained tokens are both reasonable answers and an instance
        -- should not have to pick one for every repository it touches.
        kind TEXT NOT NULL,
        -- ENCRYPTED AT REST, and never returned to the browser after it is
        -- saved. services/gitCredentials.ts holds the reasoning; it is the
        -- same mechanism the mail credentials already use.
        secret TEXT NOT NULL,
        -- Tokens only. GitHub ignores it but other hosts do not, and an empty
        -- username on a URL that needs one fails in a way nobody can read.
        username TEXT,
        -- WHAT THE LAST TEST FOUND, which is the whole point of the table.
        -- Null means never tested, which is a state worth showing: it is what
        -- the read-only deploy key was for its entire life.
        last_tested_at TEXT,
        -- Who the remote says this is. GitHub answers "Hi seanbrill/notch.fm!"
        -- for a deploy key and "Hi seanbrill!" for a user key, and that one
        -- line is what identified the problem.
        test_identity TEXT,
        test_can_read INTEGER,
        test_can_write INTEGER,
        test_error TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    // One name per group, so a list cannot show two rows nobody can tell apart.
    db.exec(`
      CREATE UNIQUE INDEX git_credentials_group_name_uq
        ON git_credentials(group_path, name)
    `);
    db.exec(`CREATE INDEX git_credentials_group_idx ON git_credentials(group_path)`);
    logger.info("git_credentials table created");
    return true;
  } catch (e) {
    logger.error(`git_credentials migration failed: ${e}`);
    return false;
  }
}
