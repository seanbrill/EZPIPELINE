// Where the assistant and the MCP server are allowed to reach, in one place.
//
// These rules existed twice, in two strengths. AnthropicAssistant had a real
// containment check and a whole-family .env test; MCPServer had
// `path.endsWith('.env')` and leaned on ConfigController, whose check was
// `fullPath.startsWith(rootDir)` - true for a SIBLING directory, so a
// pipelines root of /data/pipelines also admitted /data/pipelines-secrets.
//
// Two copies of a security rule means the weaker one is the real one. This is
// the only copy now.

import path from "path";

/**
 * Resolve `relative` inside `baseDir`, or throw.
 *
 * The final test compares against `base + path.sep` rather than `base` alone,
 * which is what stops the sibling-directory escape described above.
 */
export function containedPath(baseDir: string, relative: string): string {
    if (typeof relative !== "string" || !relative.trim()) {
        throw new Error("A file path is required.");
    }
    const candidate = relative.trim();
    if (path.isAbsolute(candidate)) {
        throw new Error(
            `Absolute paths are not allowed here. Give a path relative to the pipelines directory, such as "MyGroup/pipeline.yaml".`
        );
    }
    if (candidate.split(/[\\/]/).includes("..")) {
        throw new Error(
            `".." is not allowed in a path. Only files inside the pipelines directory can be reached.`
        );
    }
    const base = path.resolve(baseDir);
    const full = path.resolve(base, candidate);
    if (full !== base && !full.startsWith(base + path.sep)) {
        throw new Error(
            `That path resolves outside the pipelines directory, so it cannot be read or written from here.`
        );
    }
    return full;
}

/**
 * True for .env, .env.local, .env.production and friends.
 *
 * A check on the ".env" suffix alone lets ".env.production" through to a
 * full-content read. Values are the thing being protected, so this tests the
 * whole family.
 */
export function isEnvFile(filePath: string): boolean {
    const name = path.basename(filePath).toLowerCase();
    return name === ".env" || name.startsWith(".env.") || name.endsWith(".env");
}

/** The only extensions a config tool will open. */
const CONFIG_EXTENSIONS = [".yaml", ".yml"];

/**
 * Refuse anything that is not a pipeline config file.
 *
 * An allowlist, not a denylist. Blocking .env and allowing everything else
 * still hands back an id_rsa, a .pem, a deploy key or a credentials.json that
 * happens to sit in the pipelines tree - none of which anyone remembered to
 * add to a denylist, which is the whole problem with denylists. A tool called
 * read_yaml_config should read YAML.
 */
export function assertConfigFile(filePath: string): void {
    if (isEnvFile(filePath)) {
        throw new Error(
            "Environment files are never readable here, because their values are secrets. Use get_env_keys to see which variables exist."
        );
    }
    const name = path.basename(filePath).toLowerCase();
    if (!CONFIG_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        throw new Error(
            `Only ${CONFIG_EXTENSIONS.join(" and ")} files can be read or written here, and "${filePath}" is neither.`
        );
    }
}
