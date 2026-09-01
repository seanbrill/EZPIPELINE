// The one place the JWT signing secret is resolved.
//
// It used to be resolved in two places, both like this:
//
//   const SECRET = process.env.JWT_SECRET || "ezpipeline-secret-key";
//
// with a `// Should be in env` comment next to it. JWT_SECRET was set nowhere -
// not in .env, not in the compose file - so every install signed and verified
// with a constant that is committed to this repository. Anyone who can read the
// source can mint a token for the primary admin without a password, and the
// dockerized stack shipped exactly that.
//
// A default that silently works is how this survived. So there is no default
// outside development: an unset or placeholder secret stops the server with an
// explanation, which is loud, immediate and one line to fix. Development gets a
// documented throwaway so nobody has to generate a secret to run the thing
// locally, and the value is never a secret in that case because it is printed
// right here.

/** The value the codebase used to fall back to. Never acceptable now. */
const RETIRED_DEFAULT = "ezpipeline-secret-key";

/**
 * Development only, and deliberately obvious. It exists so `docker:up` works
 * with no setup; it must never appear in a deployed environment, which is what
 * the refusal below enforces.
 */
const DEV_SECRET = "dev-only-insecure-jwt-secret-do-not-deploy";

/**
 * Development is an ALLOWLIST, the same way notch.fm resolves it.
 *
 * Asking "is it production?" and taking the safe branch only on yes means an
 * unset variable - which is every environment that forgot to set one - gets the
 * permissive answer. Unknown has to mean production, or the guard protects
 * nothing.
 */
function isDevelopment(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

function resolve(): string {
  const fromEnv = (process.env.JWT_SECRET ?? "").trim();

  if (fromEnv && fromEnv !== RETIRED_DEFAULT) {
    if (fromEnv.length < 32 && !isDevelopment()) {
      throw new Error(
        "JWT_SECRET is shorter than 32 characters, which is not enough to sign " +
          "session tokens with.\n  Generate one with:  openssl rand -hex 32"
      );
    }
    return fromEnv;
  }

  if (isDevelopment()) return DEV_SECRET;

  throw new Error(
    (fromEnv === RETIRED_DEFAULT
      ? "JWT_SECRET is still the placeholder that used to be hard-coded in this repository.\n"
      : "JWT_SECRET is not set.\n") +
      "  Anyone who can read this source could otherwise forge a token for the\n" +
      "  primary admin account, so the server will not start without a real one.\n" +
      "  Generate one with:  openssl rand -hex 32\n" +
      "  Then set JWT_SECRET in the environment.\n" +
      "  NOTE: NODE_ENV is " +
      (process.env.NODE_ENV ? `"${process.env.NODE_ENV}"` : "unset") +
      ", which this build reads as production. If this is your\n" +
      "  own machine, set NODE_ENV=development."
  );
}

export const JWT_SECRET = resolve();
