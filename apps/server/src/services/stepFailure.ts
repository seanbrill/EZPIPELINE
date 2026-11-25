// What the log and the run page say when a step fails, so the reason can be found
// from the UI without a shell on the server.
//
// A failed step used to leave "Command failed with exit code 127" and nothing else:
// not which folder it ran in, not which shell, not that 127 means "not found", not
// that the variable the command used was never set. Everything here is worked out
// from what the runner already knows; nothing runs again.

export interface FailureDetail {
  /** null when the process died on a signal or never started. */
  exitCode: number | null;
  signal: string | null;
  /** What the exit code or start error means, in words, when that is known. */
  meaning: string | null;
  /** The last lines the step printed, stderr and stdout together, redacted. */
  lastLines: string[];
  /** The command as the pipeline wrote it (variable names, never their values). */
  command: string;
  cwd: string;
  shell: string;
  durationMs: number;
  /** Variables the command uses that no layer set. */
  unset: string[];
  /** Variables the command uses that are set to an empty string. */
  empty: string[];
  /** The substep path ("11.3.2") when the failure was inside one. */
  substep?: string;
  substepName?: string;
}

/** A step's command finished badly. Carries what is needed to explain it. */
export class CommandFailed extends Error {
  /** Set once the failure block is in the log, so an outer level does not print it again. */
  logged = false;
  constructor(message: string, public detail: FailureDetail) {
    super(message);
    this.name = "CommandFailed";
  }
}

const SIGNALS: Record<number, string> = { 1: "SIGHUP", 2: "SIGINT", 6: "SIGABRT", 9: "SIGKILL", 11: "SIGSEGV", 13: "SIGPIPE", 15: "SIGTERM" };

/** What an exit code or signal usually means, or null for the ordinary "the program said no". */
export function exitMeaning(code: number | null, signal: string | null): string | null {
  const sig = signal ?? (code != null && code > 128 && SIGNALS[code - 128] ? SIGNALS[code - 128] : null);
  if (sig === "SIGKILL") return "the process was killed (SIGKILL). Without an abort, that is usually the system running out of memory.";
  if (sig === "SIGTERM") return "the process was asked to stop (SIGTERM).";
  if (sig === "SIGINT") return "the process was interrupted (SIGINT).";
  if (sig === "SIGSEGV") return "the program crashed (segmentation fault).";
  if (sig === "SIGPIPE") return "the program wrote to a pipe that had closed (SIGPIPE).";
  if (sig) return `the process ended on ${sig}.`;
  if (code === 127) return "a command was not found. It is not installed on this server, or not on the PATH the step sees.";
  if (code === 126) return "a command was found but could not be run: it is not executable, or permission was denied.";
  if (code === 2) return "usually a usage or syntax error: a wrong option, or a shell syntax error.";
  return null;
}

/** What went wrong starting the process at all (spawn's error). */
export function startMeaning(err: NodeJS.ErrnoException, shell: string, cwd: string): string {
  if (err.code === "ENOENT") return shell.startsWith("/") ? `the shell ${shell} is not on this server.` : `the command or the folder ${cwd} does not exist.`;
  if (err.code === "EACCES") return `permission was denied starting the shell or entering ${cwd}.`;
  return err.message;
}

const NAME = "[A-Za-z_][A-Za-z0-9_]*";
/** Set by the shell itself, never by an env layer. */
const SHELL_OWN = new Set("RANDOM LINENO SECONDS BASH_SOURCE BASH_VERSION BASH_REMATCH BASHPID PPID UID EUID PWD OLDPWD IFS PIPESTATUS FUNCNAME HOSTNAME HOSTTYPE MACHTYPE OSTYPE REPLY OPTARG OPTIND SHLVL GROUPS COLUMNS LINES EPOCHSECONDS EPOCHREALTIME".split(" "));

/**
 * Variables the command reads that are unset or empty. ${X} and $X (capitals only for
 * the bare form, where lower case is nearly always a shell variable of the script's
 * own). A name the command assigns itself, or reads with a default (${X:-y}), is left out.
 */
export function variablesInTrouble(command: string, env: Record<string, string | undefined>): { unset: string[]; empty: string[] } {
  const used = new Set<string>();
  for (const m of command.matchAll(new RegExp(`\\$\\{(${NAME})(:?[-=?+][^}]*)?\\}`, "g"))) if (!m[2]) used.add(m[1]);
  for (const m of command.matchAll(/\$([A-Z_][A-Z0-9_]*)(?![A-Za-z0-9_{])/g)) used.add(m[1]);
  const assigned = (n: string) =>
    new RegExp(`(^|[\\s;&|(])(export\\s+|local\\s+|readonly\\s+|declare\\s+(-\\w+\\s+)*)?${n}=`).test(command) ||
    new RegExp(`\\bfor\\s+${n}\\s+in\\b`).test(command) ||
    new RegExp(`\\bread\\b[^\\n;|&]*\\s${n}\\b`).test(command);
  const unset: string[] = [], empty: string[] = [];
  for (const n of used) {
    if (SHELL_OWN.has(n) || assigned(n)) continue;
    if (!(n in env) || env[n] === undefined) unset.push(n);
    else if (env[n] === "") empty.push(n);
  }
  return { unset: unset.sort(), empty: empty.sort() };
}

const secs = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

/** "exit code 127" / "stopped by SIGKILL" / "could not start" */
export function outcome(d: Pick<FailureDetail, "exitCode" | "signal">): string {
  if (d.signal) return `stopped by ${d.signal}`;
  if (d.exitCode == null) return "could not start";
  return `exit code ${d.exitCode}`;
}

/**
 * The block the log gets under the failed step's output: the headline as an error
 * line, then one line per fact. `path` is the PATH the step had, shown only when the
 * failure was a command not being found, which is the one time it answers the question.
 */
export function failureLines(label: string, d: FailureDetail, path?: string): { headline: string; lines: string[] } {
  const headline = `✗ ${label} failed: ${outcome(d)}`;
  const lines: string[] = [];
  const row = (k: string, v: string) => lines.push(`  ${k.padEnd(8)} ${v}`);
  if (d.meaning) row("meaning", d.meaning);
  const cmd = d.command.trim().split("\n");
  row("command", cmd.length <= 3 ? cmd.join(" ⏎ ") : `${cmd[0]} … (${cmd.length} lines, shown where the step started)`);
  row("folder", d.cwd);
  row("shell", d.shell);
  row("ran for", secs(d.durationMs));
  if (d.unset.length) row("not set", `${d.unset.join(", ")}: no env layer sets ${d.unset.length === 1 ? "it" : "them"}, so the shell reads an empty value`);
  if (d.empty.length) row("empty", `${d.empty.join(", ")} ${d.empty.length === 1 ? "is" : "are"} set to an empty value`);
  if (d.exitCode === 127 && path) row("PATH", path);
  return { headline, lines };
}

/** One line for the run (build.error), notifications and the runs list. */
export function failureSummary(stepName: string, d: FailureDetail): string {
  const where = d.substep ? `${stepName} › ${d.substep}${d.substepName ? ` ${d.substepName}` : ""}` : stepName;
  const last = [...d.lastLines].reverse().find((l) => l.trim());
  return `${where} failed with ${outcome(d)}${last ? `: ${last.trim().slice(0, 300)}` : ""}`;
}
