// A credential can be made here, and a group can read with one.
//
// THE REQUEST. Setting up a second repository meant `docker exec ... ssh-keygen`
// to make a key in the data volume, another command to print its public half,
// an edit to this project's own Dockerfile to teach ssh which key belonged to
// which repository, and a rebuild. "Does ezpipeline have a way to do this
// without running a command?" It did not: the credentials screen stored a key
// somebody had already made elsewhere, and only the merge action ever used it.
//
// Two columns carry the change.
//
//   public_key     the half that goes on the forge. Kept, because the whole
//                  point of generating a key here is being able to copy that
//                  half off the screen, today and when it is added somewhere
//                  else next year. It is not a secret.
//
//   use_for_reads  whether pipelines and watches in this group READ with it.
//                  OFF for every row that already exists, deliberately: those
//                  were stored for the merge action, some can WRITE, and
//                  handing a key that can push to every step of every pipeline
//                  in the group is not something an upgrade should decide.

import { DatabaseService } from "../services/Database.js";
import Logger from "../controllers/Logger.js";

export function migrateGitCredentialReads(): boolean {
  const db = DatabaseService.getInstance().getDb();
  const logger = Logger.getInstance();

  try {
    const columns = (db.prepare(`PRAGMA table_info(git_credentials)`).all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    // The table is made by 011. Without it there is nothing to add to, and
    // saying so beats an ALTER that fails with "no such table".
    if (columns.length === 0) {
      logger.warn("git_credentials does not exist yet, so its read columns were not added");
      return false;
    }
    if (!columns.includes("public_key")) {
      db.exec(`ALTER TABLE git_credentials ADD COLUMN public_key TEXT`);
      logger.info("git_credentials.public_key added");
    }
    if (!columns.includes("use_for_reads")) {
      db.exec(`ALTER TABLE git_credentials ADD COLUMN use_for_reads INTEGER NOT NULL DEFAULT 0`);
      logger.info("git_credentials.use_for_reads added");
    }
    return true;
  } catch (e) {
    logger.error(`git_credentials read columns migration failed: ${e}`);
    return false;
  }
}
