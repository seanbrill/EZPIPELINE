// The assistant's engine: the Anthropic API, called directly.
//
// WHAT THIS REPLACED. Until now the assistant was a Claude Code CLI process.
// ClaudeManager.ts npm-installed @anthropic-ai/claude-code into ai_sandbox,
// ran an interactive OAuth login through a python PTY bridge, then answered
// every message by spawning `node cli.js -p "<the message>"` and piping raw
// terminal output at the browser. Conversation state lived in a CLI session id
// that regularly collided, so a whole "self-healing" layer existed to notice
// the collision, mint a new id, and paste the previous answer back into the
// next prompt as "[CONTEXT RESTORATION]". That was the memory: a string, cut
// at 5000 characters, re-fed to a fresh process.
//
// None of that survives here, and none of it needs to. The conversation is an
// array in this process. Tools are function calls, not JSON-RPC to a
// subprocess. There is no install step, no login step, no session lock, and no
// terminal chrome to filter back out.
//
// WHY THIS IS STRICTLY SAFER, which matters because docs/ai-assistant.md sells
// safety as the feature. The CLI was spawned with --permission-mode
// bypassPermissions AND --dangerously-skip-permissions. Its cwd was ai_sandbox,
// but cwd is not a jail: Read and Bash take absolute paths, so the documented
// promises ("cannot traverse up to read system files", "read-only outside the
// sandbox") were enforced by nothing but the wording of a prompt. Here the
// model has no shell and no filesystem primitive at all. Every effect it can
// have on this machine is one of the tools defined below, and each one checks
// its own arguments. The promise is now kept by code rather than by hope.
//
// SDK TOOLS, NOT MCP - the one judgement call worth arguing about.
// MCPServer.ts already describes this capability surface, and it stays exactly
// as it is for external MCP clients. It is not the right transport here. MCP
// exists to cross a process boundary; the CLI was that boundary. Speaking
// JSON-RPC over a pipe to a second copy of our own controllers - with a second
// better-sqlite3 writer against the same file, which mcp-entry.ts already
// worries about in its comments - would buy latency and a process lifecycle
// and nothing else. So the tools below call ConfigController and
// EZPipelineController directly, in this process, synchronously.
//
// The cost of that choice is honest: two descriptions of the same capability
// can drift. Two guards are therefore duplicated here rather than imported,
// because they live inside MCPServer's switch statement and not in the
// controllers - the .env read block, and path containment. Both are tightened
// on the way (see containedPath). The fix that removes the duplication is
// to move those guards down into ConfigController so both surfaces inherit
// them; that file is not ours to edit and the change is in the handover notes.
//
// WHAT THE MODEL CANNOT DO HERE. MCPServer exposes sixteen tools. This
// assistant gets eleven. The rule is one sentence: every read-only tool, plus
// the three set/update tools, and nothing that deletes or starts a build. A
// chat box with no confirmation step should not be able to execute a rollback
// against production or delete a global resource on the strength of a sentence
// that could have come from a pasted log line. MCP clients keep the full set.

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { DOCS_DIR, PIPELINES_DIR } from "../config/index.js";
import { assertConfigFile, containedPath, isEnvFile } from "../config/pipelinePaths.js";
import { ConfigController } from "../controllers/ConfigController.js";
import EZPipelineController from "../controllers/EZPipelineController.js";
import Logger from "../controllers/Logger.js";

// ── Configuration ───────────────────────────────────────────────────────────

/**
 * Read lazily rather than at module load. config/index.js runs dotenv.config()
 * in its own module body, and while the import graph happens to order that
 * before this file today, a build tool that reorders modules would turn that
 * into a silent "no key configured" instead of a loud failure.
 */
function apiKey(): string | undefined {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    return key ? key : undefined;
}

/** Overridable so an operator can trade capability for cost without a rebuild. */
function model(): string {
    return process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5";
}

// A ceiling, not a target. Chat answers are short; this only exists so a
// pathological generation cannot run for ten minutes on someone's bill.
const MAX_TOKENS = 16000;

// Tool calls per user message. The loop below is a real agentic loop, so it
// needs a stop that does not depend on the model choosing to stop.
const MAX_TOOL_ROUNDS = 12;

// Kept turns per conversation. Trimming happens on turn boundaries only - see
// trimHistory for why an arbitrary slice is a 400 from the API.
const MAX_HISTORY_MESSAGES = 60;

// Sessions are held per socket. We cannot hook socket disconnect from here
// (that wiring lives in server.ts, which this task does not own), so idle
// expiry and an LRU cap stand in for it.
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 50;

type Emit = (event: string, data: unknown) => void;

interface Session {
    history: Anthropic.MessageParam[];
    /** One in-flight request per socket. A second one would interleave into the same history. */
    busy: boolean;
    lastUsed: number;
}

/** The shape every tool returns. Never an empty array, never a bare code. */
interface ToolOutcome {
    text: string;
    isError: boolean;
}

function ok(text: string): ToolOutcome {
    return { text, isError: false };
}

/**
 * Failure is always labelled. A tool that answered "[]" on failure would be
 * indistinguishable from a tool that answered "nothing matched", and the model
 * would confidently report the wrong one to the user.
 */
function fail(message: string): ToolOutcome {
    return { text: `Error: ${message}`, isError: true };
}

// ── Path containment ────────────────────────────────────────────────────────

/**
 * Resolves a caller-supplied relative path inside a directory, or throws.
 *
 * ConfigController does its own check with `fullPath.startsWith(this.rootDir)`,
 * which passes for a sibling directory sharing the prefix (".../pipelines-old"
 * starts with ".../pipelines"). That is a real hole, it is in a file this task
 * does not own, and it is in the handover notes. This function is the version
 * the assistant relies on: the separator is part of the comparison, absolute
 * paths are refused outright rather than silently re-rooted, and ".." is
 * refused before resolution so the rejection message can say what was wrong.
 */

// ── The tools ───────────────────────────────────────────────────────────────

interface AssistantTool {
    definition: Anthropic.Tool;
    run: (input: Record<string, unknown>) => Promise<ToolOutcome> | ToolOutcome;
}

/**
 * Input schemas are plain JSON Schema and are NOT marked `strict: true`.
 * Strict mode requires every property to be listed in `required`, which cannot
 * express get_build_history's optional group filter without splitting the tool
 * in two. Each run() validates its own arguments instead and explains what was
 * wrong, which the model can act on; a schema rejection it never sees, it
 * cannot.
 */
function buildTools(): AssistantTool[] {
    const config = () => ConfigController.getInstance();
    const pipelines = () => EZPipelineController.instance;

    const str = (input: Record<string, unknown>, key: string): string | undefined => {
        const value = input[key];
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
    };

    return [
        {
            definition: {
                name: "list_pipelines",
                description: "List every pipeline, with its group, config file path and the status of its most recent build.",
                input_schema: { type: "object", properties: {} },
            },
            run: () => {
                const targets = pipelines()?.targets ?? [];
                if (targets.length === 0) {
                    // Not "[]". The difference between "no pipelines exist" and
                    // "the lookup failed" is the whole reason this reads as a
                    // sentence.
                    return ok("There are no pipelines configured yet.");
                }
                const builds = pipelines()?.builds ?? [];
                const rows = targets.map((target) => {
                    const mine = builds.filter((b) => b.target === target.id);
                    const latest = mine[mine.length - 1];
                    return {
                        id: target.id,
                        appName: target.appName,
                        group: target.group || "General",
                        filePath: target.filePath,
                        lastBuildStatus: latest ? latest.status : "never run",
                        lastBuildStarted: latest ? latest.started : null,
                    };
                });
                return ok(JSON.stringify(rows, null, 2));
            },
        },

        {
            definition: {
                name: "read_yaml_config",
                description: "Read a pipeline configuration file. Paths are relative to the pipelines directory. Environment files cannot be read - use get_env_keys for those.",
                input_schema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: `Relative path, for example "MyGroup/my-app/pipeline.yaml".` },
                    },
                    required: ["path"],
                },
            },
            run: (input) => {
                const target = str(input, "path");
                if (!target) return fail(`"path" is required and must be a non-empty string.`);
                try {
                    // An allowlist: .env was blocked, but an SSH key, a .pem or
                    // a credentials.json sitting in the pipelines tree was not.
                    assertConfigFile(target);
                    const full = containedPath(PIPELINES_DIR, target);
                    if (!fs.existsSync(full)) return fail(`No file at "${target}". Use list_pipelines to see the paths that exist.`);
                    if (fs.statSync(full).isDirectory()) return fail(`"${target}" is a directory, not a file.`);
                    return ok(fs.readFileSync(full, "utf-8"));
                } catch (e: any) {
                    return fail(e.message);
                }
            },
        },

        {
            definition: {
                name: "update_yaml_config",
                description: "Overwrite a pipeline YAML file. The content is parsed before it is written, so a syntax error is refused rather than saved. A timestamped backup of the previous version is kept.",
                input_schema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative path to a .yaml or .yml file." },
                        content: { type: "string", description: "The complete new file content." },
                    },
                    required: ["path", "content"],
                },
            },
            run: (input) => {
                const target = str(input, "path");
                const content = typeof input.content === "string" ? input.content : undefined;
                if (!target) return fail(`"path" is required and must be a non-empty string.`);
                if (content === undefined) return fail(`"content" is required and must be a string holding the whole file.`);
                // The write tool is restricted by extension. MCPServer's version
                // accepts any path, which makes a tool called update_yaml_config
                // able to overwrite a shell script.
                try {
                    assertConfigFile(target);
                    containedPath(PIPELINES_DIR, target);
                    // MCPServer's description promises validation and its
                    // implementation does not do it. Here it is actually done,
                    // because a pipeline file that no longer parses takes the
                    // pipeline out of the list entirely.
                    parseYaml(content);
                } catch (e: any) {
                    return fail(`That YAML does not parse, so it was not written: ${e.message}`);
                }
                try {
                    config().saveFileContent("yaml", target, content);
                    return ok(`Wrote ${target}. The previous version was backed up first.`);
                } catch (e: any) {
                    return fail(`Could not write ${target}: ${e.message}`);
                }
            },
        },

        {
            definition: {
                name: "get_env_keys",
                description: "List the variable NAMES in a pipeline .env file. Values are never returned by this or any other tool.",
                input_schema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: `Relative path to the .env file, for example "MyGroup/my-app/.env".` },
                    },
                    required: ["path"],
                },
            },
            run: (input) => {
                const target = str(input, "path");
                if (!target) return fail(`"path" is required and must be a non-empty string.`);
                try {
                    containedPath(PIPELINES_DIR, target);
                    const keys = config().getEnvKeys(target);
                    if (keys.length === 0) return ok(`${target} exists but defines no variables.`);
                    return ok(`Variables defined in ${target} (names only):\n${keys.join("\n")}`);
                } catch (e: any) {
                    // "File not found" from ConfigController is a bare phrase.
                    // Say which file, so the answer the user sees is actionable.
                    if (e.message === "File not found") return fail(`There is no env file at "${target}".`);
                    return fail(e.message);
                }
            },
        },

        {
            definition: {
                name: "set_env_variable",
                description: "Set or update one variable in a pipeline .env file, creating the file if needed. The value is written but never read back or shown.",
                input_schema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative path to the .env file." },
                        key: { type: "string", description: "Variable name." },
                        value: { type: "string", description: "Variable value." },
                    },
                    required: ["path", "key", "value"],
                },
            },
            run: (input) => {
                const target = str(input, "path");
                const key = str(input, "key");
                const value = typeof input.value === "string" ? input.value : undefined;
                if (!target) return fail(`"path" is required and must be a non-empty string.`);
                if (!key) return fail(`"key" is required and must be a non-empty string.`);
                if (value === undefined) return fail(`"value" is required and must be a string.`);
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                    return fail(`"${key}" is not a valid variable name. Use letters, digits and underscores, starting with a letter or underscore.`);
                }
                // Without this, set_env_variable is an append-anything tool: it
                // would happily add a KEY=value line to a pipeline.yaml.
                if (!isEnvFile(target)) {
                    return fail(`This tool only writes environment files, and "${target}" is not one.`);
                }
                try {
                    containedPath(PIPELINES_DIR, target);
                    let raw = "";
                    try {
                        raw = config().getFileContent("env", target);
                    } catch (e: any) {
                        // A missing file is the create case, not a failure.
                        if (e.message !== "File not found") throw e;
                    }
                    const lines = raw ? raw.split("\n") : [];
                    let found = false;
                    const updated = lines.map((line) => {
                        const trimmed = line.trim();
                        if (trimmed.startsWith(`${key}=`) || trimmed.startsWith(`export ${key}=`)) {
                            found = true;
                            return `${key}=${value}`;
                        }
                        return line;
                    });
                    if (!found) updated.push(`${key}=${value}`);
                    config().saveFileContent("env", target, updated.join("\n"));
                    // The confirmation deliberately does not echo the value.
                    return ok(`${found ? "Updated" : "Added"} ${key} in ${target}. The value is not shown back.`);
                } catch (e: any) {
                    return fail(`Could not set ${key} in ${target}: ${e.message}`);
                }
            },
        },

        {
            definition: {
                name: "get_global_env_keys",
                description: "List the NAMES of the global environment variables shared by every pipeline. Values are never returned.",
                input_schema: { type: "object", properties: {} },
            },
            run: () => {
                try {
                    const keys = config().getGlobalEnvKeys();
                    if (keys.length === 0) return ok("No global environment variables are set.");
                    return ok(`Global variables (names only):\n${keys.join("\n")}`);
                } catch (e: any) {
                    return fail(`Could not read the global environment: ${e.message}`);
                }
            },
        },

        {
            definition: {
                name: "set_global_env_variable",
                description: "Set or update one global environment variable, available to every pipeline. The value is written but never read back or shown.",
                input_schema: {
                    type: "object",
                    properties: {
                        key: { type: "string", description: "Variable name." },
                        value: { type: "string", description: "Variable value." },
                    },
                    required: ["key", "value"],
                },
            },
            run: (input) => {
                const key = str(input, "key");
                const value = typeof input.value === "string" ? input.value : undefined;
                if (!key) return fail(`"key" is required and must be a non-empty string.`);
                if (value === undefined) return fail(`"value" is required and must be a string.`);
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                    return fail(`"${key}" is not a valid variable name.`);
                }
                try {
                    config().setGlobalEnvVariable(key, value);
                    return ok(`Set ${key} globally. It applies to every pipeline. The value is not shown back.`);
                } catch (e: any) {
                    return fail(`Could not set ${key}: ${e.message}`);
                }
            },
        },

        {
            definition: {
                name: "get_global_resources",
                description: "List the shared resource files (scripts, certificates, templates) available to every pipeline.",
                input_schema: { type: "object", properties: {} },
            },
            run: () => {
                try {
                    const resources = config().getGlobalResources();
                    if (resources.length === 0) return ok("There are no global resources.");
                    return ok(JSON.stringify(resources, null, 2));
                } catch (e: any) {
                    return fail(`Could not list global resources: ${e.message}`);
                }
            },
        },

        {
            definition: {
                name: "list_documentation",
                description: "List the EZPIPELINE documentation files. This is the primary source of truth about how the product works.",
                input_schema: { type: "object", properties: {} },
            },
            run: () => {
                if (!fs.existsSync(DOCS_DIR)) {
                    return fail(`The documentation directory is missing from this install (expected at ${DOCS_DIR}).`);
                }
                const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
                if (files.length === 0) return ok("The documentation directory exists but contains no markdown files.");
                return ok(files.join("\n"));
            },
        },

        {
            definition: {
                name: "read_documentation",
                description: "Read one documentation file by name, for example pipeline-schema.md.",
                input_schema: {
                    type: "object",
                    properties: {
                        filename: { type: "string", description: "File name only, no directories." },
                    },
                    required: ["filename"],
                },
            },
            run: (input) => {
                const filename = str(input, "filename");
                if (!filename) return fail(`"filename" is required and must be a non-empty string.`);
                try {
                    const full = containedPath(DOCS_DIR, filename);
                    if (path.dirname(full) !== path.resolve(DOCS_DIR)) {
                        return fail("Give a file name only - the documentation is a flat directory.");
                    }
                    if (!fs.existsSync(full)) return fail(`There is no documentation file called "${filename}". Use list_documentation to see what exists.`);
                    return ok(fs.readFileSync(full, "utf-8"));
                } catch (e: any) {
                    return fail(e.message);
                }
            },
        },

        {
            definition: {
                name: "get_build_history",
                description: "Recent build history across all pipelines, newest first, optionally filtered to one group.",
                input_schema: {
                    type: "object",
                    properties: {
                        group: { type: "string", description: "Optional group name to filter by." },
                    },
                },
            },
            run: (input) => {
                const group = str(input, "group");
                try {
                    const history = pipelines()?.getBuildHistory(group) ?? [];
                    if (history.length === 0) {
                        return ok(group ? `No builds have been recorded for group "${group}".` : "No builds have been recorded yet.");
                    }
                    // Step arrays carry per-step logs and timings and can run to
                    // megabytes. The model needs the shape of the run, not the
                    // transcript, and a summarised step list keeps a routine
                    // question from consuming the context window.
                    const trimmed = history.map((entry) => ({
                        buildNumber: entry.buildNumber,
                        pipelineName: entry.pipelineName,
                        group: entry.group,
                        status: entry.status,
                        startTime: entry.startTime,
                        durationMs: entry.duration,
                        triggeredBy: entry.triggeredBy,
                        steps: (entry.steps ?? []).map((step: any) => ({ name: step?.name, status: step?.status })),
                    }));
                    return ok(JSON.stringify(trimmed, null, 2));
                } catch (e: any) {
                    return fail(`Could not read build history: ${e.message}`);
                }
            },
        },
    ];
}

// ── System prompt ───────────────────────────────────────────────────────────

/**
 * What used to be written to ai_sandbox/INSTRUCTIONS.md and then fetched by
 * telling the CLI "Read INSTRUCTIONS.md. Do not recite them." - a round trip
 * through the filesystem and a tool call, per session, to deliver a constant.
 * It is a constant, so it is a constant.
 */
const SYSTEM_PROMPT = `You are the assistant built into EZPIPELINE, a self-hosted CI/CD platform. You help the person running it inspect and edit pipelines, debug configuration, and understand the product.

## What you can and cannot do
You have no shell, no filesystem access and no network. The tools listed for you are your only capabilities. If someone asks for something no tool covers - running a build, deleting a pipeline, rolling back a release - say plainly that you cannot do it from here and name the part of the interface that can. Never claim an action succeeded unless a tool returned success.

## Secrets
You can see the NAMES of environment variables and you can set values. You can never read a value back, and no tool will give you one. Do not guess at a value, do not repeat a value the user typed at you, and do not write a value into a YAML file where it would be stored in plain text.

## Pipeline schema rules
- targetName is DEPRECATED. Identify a pipeline by its id (a UUID) and show its appName.
- Steps use "run" for shell commands. There is no "command" property.
- There is no "image" property.
- EZPIPELINE runs on Linux. Use shell: /bin/bash and bash syntax. Never PowerShell: echo, not Write-Host, and \${VAR}, not $env:VAR.
- Read the current file with read_yaml_config before you rewrite it, so you keep the fields you were not asked to change.
- pipeline-schema.md is the authority on all of this. Read it with read_documentation when a question turns on a detail.

## Working style
Answer the question that was asked, briefly. This is a technical audience looking at a small chat panel: no preamble, no summary of what you are about to do, no offering three follow-up tasks nobody requested. When you change a file, say which file and what changed.`;

// ── Streaming into a chat log ───────────────────────────────────────────────

/**
 * Batches token deltas into bubble-sized chunks.
 *
 * The client pushes every "claude-output" event into an array and renders each
 * entry as its own message bubble. Emitting per token would therefore produce
 * one bubble per token. Under the CLI the events were stdout chunks, which is
 * why it looked fine; the shape of the client is the constraint, not the API.
 *
 * So: flush on a paragraph break, which is where a bubble naturally ends; on a
 * sentence end once enough time has passed that a long paragraph would
 * otherwise look frozen; and on a hard character cap so a model that never
 * punctuates still streams. Rejected: a plain interval flush, which cuts
 * mid-word and reads worse than not streaming at all.
 *
 * The client change that would allow true token streaming - appending deltas to
 * the last bubble instead of pushing a new one - is in the handover notes.
 */
class OutputBatcher {
    private buffer = "";
    private lastFlush = Date.now();

    private static readonly HARD_CAP = 900;
    private static readonly SENTENCE_AFTER_MS = 1200;

    constructor(private readonly send: (chunk: string) => void) { }

    public push(delta: string): void {
        this.buffer += delta;

        const paragraph = this.buffer.lastIndexOf("\n\n");
        if (paragraph !== -1) {
            this.flushTo(paragraph + 2);
            return;
        }
        if (this.buffer.length >= OutputBatcher.HARD_CAP) {
            const line = this.buffer.lastIndexOf("\n");
            this.flushTo(line > 0 ? line + 1 : this.buffer.length);
            return;
        }
        if (Date.now() - this.lastFlush >= OutputBatcher.SENTENCE_AFTER_MS) {
            const sentence = this.lastSentenceEnd();
            if (sentence > 0) this.flushTo(sentence);
        }
    }

    public end(): void {
        this.flushTo(this.buffer.length);
    }

    /** Scanned backwards rather than matched with a lookahead regex: the "last
     *  occurrence" form of that regex backtracks across the whole buffer on
     *  every delta, which is thousands of times per answer. */
    private lastSentenceEnd(): number {
        for (let i = this.buffer.length - 2; i > 0; i--) {
            if (".!?".includes(this.buffer[i]) && /\s/.test(this.buffer[i + 1])) return i + 1;
        }
        return -1;
    }

    private flushTo(index: number): void {
        if (index <= 0) return;
        const chunk = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index);
        this.lastFlush = Date.now();
        if (chunk.trim()) this.send(chunk);
    }
}

// ── The service ─────────────────────────────────────────────────────────────

export class AnthropicAssistant {
    private static singleton: AnthropicAssistant;

    private client: Anthropic | null = null;
    private readonly tools = buildTools();
    private readonly sessions = new Map<string, Session>();
    private readonly log = Logger.getInstance();

    private constructor() {
        this.log.info(`[Assistant] Anthropic API engine ready. Model ${model()}, ${this.tools.length} tools, API key ${apiKey() ? "configured" : "NOT configured"}.`);
    }

    public static getInstance(): AnthropicAssistant {
        if (!AnthropicAssistant.singleton) {
            AnthropicAssistant.singleton = new AnthropicAssistant();
        }
        return AnthropicAssistant.singleton;
    }

    // ── Status ──────────────────────────────────────────────────────────────

    public isConfigured(): boolean {
        return apiKey() !== undefined;
    }

    /**
     * The sentence shown to a person when there is no key. It names the
     * variable, the file and the restart, because "not configured" on its own
     * sends someone hunting through a settings screen that does not exist -
     * the key is deliberately server-side only and there is nowhere in the
     * interface to type it.
     */
    public missingKeyMessage(): string {
        return "The assistant has no Anthropic API key. Set ANTHROPIC_API_KEY in the .env file at the root of the EZPIPELINE install (see .env.example) and restart the server. The key is read on the server only - there is no field in this interface to enter it, by design.";
    }

    public status() {
        const configured = this.isConfigured();
        return {
            // Kept for the existing client, which switches on these two names.
            // "installed" now means the engine is present in the build, which
            // it always is - there is nothing left to install. "loggedIn" means
            // a key is configured. The honest names are the two fields below.
            installed: true,
            loggedIn: configured,
            engine: "anthropic-api",
            configured,
            model: configured ? model() : null,
            message: configured ? null : this.missingKeyMessage(),
        };
    }

    // ── Session lifecycle ───────────────────────────────────────────────────

    public hasSession(socketId: string): boolean {
        this.sweep();
        return this.sessions.has(socketId);
    }

    /**
     * Called when the interface starts or restarts the agent. Deliberately
     * costs nothing: the old engine spent a whole API round trip asking the
     * model to produce a greeting the client then replaced with its own
     * "Agent Connected" banner anyway.
     */
    public start(socketId: string, emit: Emit): void {
        this.sweep();
        this.sessions.set(socketId, { history: [], busy: false, lastUsed: Date.now() });
        this.evictOldest();

        if (!this.isConfigured()) {
            emit("claude-error", this.missingKeyMessage());
        }
        // Emitted either way, including on the failure path: the client's
        // spinner only stops on this event, and a spinner that never stops is
        // a worse way to learn about a missing key than a red line saying so.
        emit("claude-init-complete", true);
    }

    public reset(socketId: string): void {
        this.sessions.delete(socketId);
    }

    private sweep(): void {
        const cutoff = Date.now() - SESSION_IDLE_MS;
        for (const [id, session] of this.sessions) {
            if (session.lastUsed < cutoff && !session.busy) this.sessions.delete(id);
        }
    }

    private evictOldest(): void {
        while (this.sessions.size > MAX_SESSIONS) {
            let oldestId: string | null = null;
            let oldestAt = Infinity;
            for (const [id, session] of this.sessions) {
                if (!session.busy && session.lastUsed < oldestAt) {
                    oldestAt = session.lastUsed;
                    oldestId = id;
                }
            }
            if (!oldestId) return;
            this.sessions.delete(oldestId);
        }
    }

    /**
     * Drops the oldest turns once a conversation gets long, but only at a
     * boundary where the surviving history still starts with a plain user
     * turn. Slicing at an arbitrary index can leave a tool_result whose
     * matching tool_use has been dropped, and the API rejects that with a 400 -
     * the conversation would break permanently, mid-chat, for one person only.
     */
    private trimHistory(session: Session): void {
        if (session.history.length <= MAX_HISTORY_MESSAGES) return;

        let cut = session.history.length - MAX_HISTORY_MESSAGES;
        while (cut < session.history.length && !AnthropicAssistant.isPlainUserTurn(session.history[cut])) {
            cut++;
        }
        // If no safe boundary exists, keep the whole thing. Being over the soft
        // cap costs tokens; a 400 costs the conversation.
        if (cut >= session.history.length) return;
        session.history = session.history.slice(cut);
    }

    private static isPlainUserTurn(message: Anthropic.MessageParam): boolean {
        if (message.role !== "user") return false;
        if (typeof message.content === "string") return true;
        return !message.content.some((block) => block.type === "tool_result");
    }

    // ── The turn ────────────────────────────────────────────────────────────

    /**
     * Runs one user message to completion, streaming as it goes.
     *
     * Resolves rather than throws: every failure path has already been reported
     * to the person over the socket, and the HTTP caller has long since
     * returned 202.
     */
    public async send(socketId: string, input: string, emit: Emit): Promise<void> {
        const text = typeof input === "string" ? input.trim() : "";
        if (!text) {
            emit("claude-error", "That message was empty, so nothing was sent.");
            return;
        }
        if (!this.isConfigured()) {
            emit("claude-error", this.missingKeyMessage());
            return;
        }

        this.sweep();
        let session = this.sessions.get(socketId);
        if (!session) {
            // Lazily created. The client only calls spawn from its setup
            // screen, so a browser that reconnects mid-conversation would
            // otherwise be told it has no session for a chat box it is
            // looking at.
            session = { history: [], busy: false, lastUsed: Date.now() };
            this.sessions.set(socketId, session);
            this.evictOldest();
        }
        if (session.busy) {
            emit("claude-error", "The assistant is still answering the previous message. Wait for it to finish before sending another.");
            return;
        }

        session.busy = true;
        session.lastUsed = Date.now();
        session.history.push({ role: "user", content: text });
        this.trimHistory(session);

        const batcher = new OutputBatcher((chunk) => emit("claude-output", chunk));

        try {
            await this.runLoop(session, batcher, emit);
        } catch (e: unknown) {
            batcher.end();
            emit("claude-error", this.describe(e));
            // The failed turn is removed rather than left in place. A history
            // ending in a user message with no assistant reply is valid to
            // send again, but it would silently re-ask the failed question on
            // the next message and bill for it twice.
            this.rollbackToLastUserTurn(session);
        } finally {
            session.busy = false;
            session.lastUsed = Date.now();
            // The client stops its typing indicator on output or on error, and
            // clears any "restarting" state on exit. Emitting exit here keeps
            // the indicator honest even when a turn produced no text at all.
            emit("claude-exit", 0);
        }
    }

    private async runLoop(session: Session, batcher: OutputBatcher, emit: Emit): Promise<void> {
        const client = this.getClient();
        const definitions = this.tools.map((tool) => tool.definition);

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const stream = client.messages.stream({
                model: model(),
                max_tokens: MAX_TOKENS,
                // Adaptive is the default on this model family; naming it makes
                // the intent survive a model change. display is left at its
                // default of omitted: the client renders every emitted chunk as
                // a chat bubble, so streaming a reasoning summary there would
                // read as the assistant talking to itself.
                thinking: { type: "adaptive" },
                output_config: { effort: "high" },
                system: [
                    {
                        type: "text",
                        text: SYSTEM_PROMPT,
                        // Tools render before system, so one breakpoint here
                        // caches both. Every turn of every conversation repeats
                        // this exact prefix, which is the case caching exists
                        // for.
                        cache_control: { type: "ephemeral" },
                    },
                ],
                tools: definitions,
                // A copy, not the live array. The SDK serialises the body
                // before this call returns, so passing the original works
                // today - but this loop appends to session.history while the
                // request is still in flight, and handing a mutable array to
                // an in-flight request stays correct only until some SDK
                // release makes the body lazy.
                messages: [...session.history],
            });

            stream.on("text", (delta) => batcher.push(delta));

            const message = await stream.finalMessage();
            session.history.push({ role: "assistant", content: message.content });

            if (message.stop_reason === "refusal") {
                batcher.end();
                const detail = message.stop_details?.explanation;
                emit("claude-error", `The model declined to answer that${detail ? `: ${detail}` : "."}`);
                return;
            }

            if (message.stop_reason === "max_tokens") {
                batcher.end();
                emit("claude-error", "The answer hit its length limit and was cut off. Ask for a narrower slice of it.");
                return;
            }

            // A server-side tool paused the turn. Nothing to execute: send the
            // conversation straight back to continue it.
            if (message.stop_reason === "pause_turn") continue;

            if (message.stop_reason !== "tool_use") {
                batcher.end();
                return;
            }

            const calls = message.content.filter(
                (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
            );

            // Paragraph-flush the prose written before the tool calls, so the
            // "running list_pipelines" line does not land in the middle of it.
            batcher.end();

            const results: Anthropic.ToolResultBlockParam[] = [];
            for (const call of calls) {
                // Grey, so the client's own log-line styling picks it up and it
                // reads as machinery rather than as the assistant speaking.
                emit("claude-output", `\u001b[90m› ${call.name}\u001b[0m`);
                const outcome = await this.runTool(call);
                results.push({
                    type: "tool_result",
                    tool_use_id: call.id,
                    content: outcome.text,
                    is_error: outcome.isError,
                });
            }

            // All results in ONE user message. Splitting them across messages
            // teaches the model to stop calling tools in parallel.
            session.history.push({ role: "user", content: results });
            this.trimHistory(session);
        }

        batcher.end();
        emit("claude-error", `The assistant used its ${MAX_TOOL_ROUNDS} tool calls for this message without finishing. Ask for one step at a time.`);
    }

    private async runTool(call: Anthropic.ToolUseBlock): Promise<ToolOutcome> {
        const tool = this.tools.find((candidate) => candidate.definition.name === call.name);
        if (!tool) {
            // Unreachable unless a definition and the table disagree, which is
            // exactly the bug worth naming out loud rather than answering "[]".
            this.log.error(`[Assistant] Model called unknown tool "${call.name}"`);
            return fail(`There is no tool called "${call.name}".`);
        }
        this.log.info(`[Assistant] Tool ${call.name}`);
        try {
            const input = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
            return await tool.run(input);
        } catch (e: any) {
            // A throwing tool must still return a result block, or the next
            // request is missing a tool_result and the API rejects the whole
            // conversation.
            this.log.error(`[Assistant] Tool ${call.name} threw`, e);
            return fail(`${call.name} failed: ${e?.message ?? "unknown error"}`);
        }
    }

    private rollbackToLastUserTurn(session: Session): void {
        while (session.history.length > 0) {
            const last = session.history[session.history.length - 1];
            session.history.pop();
            if (AnthropicAssistant.isPlainUserTurn(last)) return;
        }
    }

    private getClient(): Anthropic {
        // Built once and reused so the SDK's connection pooling and retries
        // apply across turns. Never logged, never returned, never sent to the
        // client: the key exists only inside this object.
        if (!this.client) {
            this.client = new Anthropic({ apiKey: apiKey() });
        }
        return this.client;
    }

    /**
     * Turns an SDK error into a sentence a person can act on. The typed classes
     * are checked most specific first; string matching on error text is how
     * this stops working after an SDK upgrade.
     */
    private describe(e: unknown): string {
        if (e instanceof Anthropic.AuthenticationError) {
            return "The Anthropic API rejected the configured key. Check ANTHROPIC_API_KEY in the server .env file.";
        }
        if (e instanceof Anthropic.PermissionDeniedError) {
            return "The configured Anthropic API key is not allowed to use this model. Check the key's permissions, or set ANTHROPIC_MODEL to a model it can reach.";
        }
        if (e instanceof Anthropic.RateLimitError) {
            return "The Anthropic API is rate limiting this key. Wait a moment and send the message again.";
        }
        if (e instanceof Anthropic.NotFoundError) {
            return `The Anthropic API does not recognise the model "${model()}". Check ANTHROPIC_MODEL in the server .env file.`;
        }
        if (e instanceof Anthropic.BadRequestError) {
            // Worth surfacing verbatim: it is nearly always our request that is
            // wrong, and hiding it behind "something went wrong" makes it
            // undebuggable from the interface.
            this.log.error(`[Assistant] Bad request to the Anthropic API: ${e.message}`);
            return `The assistant sent a request the Anthropic API refused: ${e.message}`;
        }
        if (e instanceof Anthropic.APIConnectionError) {
            return "Could not reach the Anthropic API. Check this server's outbound network access.";
        }
        if (e instanceof Anthropic.APIError) {
            this.log.error(`[Assistant] Anthropic API error ${e.status}: ${e.message}`);
            return `The Anthropic API returned an error (${e.status}): ${e.message}`;
        }
        const message = e instanceof Error ? e.message : String(e);
        this.log.error(`[Assistant] Unexpected failure: ${message}`);
        return `The assistant failed: ${message}`;
    }
}
