// Encryption for the credentials an operator types into Settings.
//
// WHY THIS EXISTS. The SMTP password was written to the `settings` table in
// plain text, and the GET route handed it back UNMASKED - it masked only the
// value that came from the environment. So any admin session could read the
// stored password, and so could anyone who opened app.db. For a Gmail app
// password that is a mailbox; for an API key it is the ability to send mail as
// the company.
//
// THE KEY COMES FROM JWT_SECRET, derived rather than reused directly.
//
// A separate variable would be better in the abstract and worse in practice:
// nobody sets a second secret, and a mail provider that silently stops working
// because a new env var is missing is how this feature gets abandoned.
// config/secret.ts already refuses to boot on a JWT_SECRET that is short or is
// the old hard-coded placeholder, so this inherits a key that has been checked.
//
// THE COUPLING IS REAL AND WORTH KNOWING: rotating JWT_SECRET makes every
// stored credential undecryptable. That is why decryption failure is reported
// as "absent, and here is why" rather than thrown - the operator is told to
// re-enter it, instead of watching mail fail with a crypto error.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { JWT_SECRET } from "../../config/secret.js";
import Logger from "../../controllers/Logger.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const PREFIX = "enc:v1:";

/**
 * A distinct key, not JWT_SECRET itself.
 *
 * The same bytes signing sessions should not also encrypt data at rest: the
 * two have different lifetimes and different exposure, and deriving costs one
 * call. The info string names the purpose so a second derived key can never
 * collide with this one.
 */
function key(): Buffer {
  return Buffer.from(
    hkdfSync("sha256", JWT_SECRET, "ezpipeline-settings-salt", "mail-credentials-v1", 32)
  );
}

/** Already encrypted by us? Lets a plaintext value be read once and upgraded. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  // GCM's tag is what makes this tamper-evident rather than merely unreadable.
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${body.toString("base64")}`;
}

/**
 * Decrypt, or null.
 *
 * NULL RATHER THAN A THROW. Two ordinary situations produce an unreadable
 * value - a rotated JWT_SECRET, and a row written before this existed - and
 * neither should take down the route that happens to send an email. The caller
 * treats null as "no credential", which every provider already handles by
 * refusing to send and saying so.
 */
export function decryptSecret(stored: string): string | null {
  if (!stored) return null;
  if (!isEncrypted(stored)) {
    // Written before encryption existed. Readable, and worth flagging so it
    // gets rewritten rather than living in the clear indefinitely.
    Logger.getInstance().warn(
      "[mail] a stored credential is not encrypted. Re-save it in Settings to " +
        "encrypt it at rest."
    );
    return stored;
  }
  try {
    const [ivB64, tagB64, bodyB64] = stored.slice(PREFIX.length).split(":");
    if (!ivB64 || !tagB64 || !bodyB64) return null;
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(bodyB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    Logger.getInstance().warn(
      "[mail] a stored credential could not be decrypted. The usual cause is a " +
        "changed JWT_SECRET, which this key is derived from. Re-enter the " +
        "credential in Settings."
    );
    return null;
  }
}
