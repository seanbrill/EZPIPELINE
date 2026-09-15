// Every React hook a file calls must be imported in that file.
//
// ── WHY THIS IS NOT ALREADY COVERED ────────────────────────────────────────
//
// It looks like something the toolchain must already catch, and nothing does:
//
//   tsc      @types/react declares its hooks as a UMD GLOBAL, so a bare
//            `useMemo` resolves at the type level and is undefined at runtime.
//            `npx tsc --noEmit` passes on the broken file.
//
//   eslint   `no-undef` is switched off for TypeScript by convention -
//            typescript-eslint recommends it, because TS is supposed to be
//            handling exactly this. Here it does not.
//
// So the first thing that notices is the browser, with a blank page. That is
// what happened on 2026-09-15: `useMemo` was added to DashboardPage without
// touching the import, both checks passed, and the dashboard threw on render
// in the tool Sean was using at the time.
//
// Thirty lines to close a class the type checker cannot see.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../apps/client/src", import.meta.url).pathname;

/** Hooks that must come from react itself. */
const REACT_HOOKS = [
  "useState", "useEffect", "useMemo", "useCallback", "useRef",
  "useContext", "useReducer", "useLayoutEffect", "useImperativeHandle",
  "useTransition", "useDeferredValue", "useId", "useSyncExternalStore",
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
if (files.length === 0) throw new Error(`no source under ${ROOT} - this check read nothing`);

const problems = [];
let calls = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");

  // What this file brings in from react, in either quote style, plus the
  // namespace form - `React.useMemo(...)` is always fine.
  const importLine = /import\s+(?:React\s*,\s*)?\{([^}]*)\}\s*from\s*['"]react['"]/.exec(src);
  const imported = new Set(
    (importLine?.[1] ?? "").split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)
  );

  for (const hook of REACT_HOOKS) {
    // A call, not a mention: `useMemo(` with no `.` in front, so
    // React.useMemo and someObject.useMemo do not count.
    const re = new RegExp(`(^|[^.\\w])${hook}\\s*\\(`, "m");
    if (!re.test(src)) continue;
    calls++;
    if (imported.has(hook)) continue;
    const line = src.split("\n").findIndex((l) => new RegExp(`(^|[^.\\w])${hook}\\s*\\(`).test(l)) + 1;
    problems.push(
      `${file.replace(ROOT, "src")}:${line} calls ${hook}() and does not import it from react.\n` +
        `      tsc will not catch this - @types/react declares hooks as a UMD global, so it\n` +
        `      resolves at the type level and is undefined at runtime. The page throws on\n` +
        `      render and goes blank.`
    );
  }
}

if (calls === 0) throw new Error("found no hook calls at all - this check read nothing");

if (problems.length === 0) {
  console.log(`ok    ${calls} hook call sites across ${files.length} files, all imported`);
  process.exit(0);
}

console.log("FAIL  a React hook is called without being imported");
for (const p of problems) console.log(`    ${p}`);
process.exit(1);
