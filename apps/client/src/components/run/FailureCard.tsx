/**
 * Why a run failed, at the top of its page (design sheet f76, phone f126).
 *
 * What the server recorded about the failed step (services/stepFailure.ts): the exit code
 * and what it usually means, where and how the command ran, variables it uses that no
 * layer sets, and the last lines it printed. Enough to see the reason without opening
 * the server. The log below has the rest; "Jump to the error" takes it there.
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, CircleX, Play, RotateCcw } from 'lucide-react';
import Ansi from 'ansi-to-react';
import type { BuildHistoryEntry, LogLine, RunStep } from '../../types/build';
import { formatDurationCompact } from '../../helpers/formatDuration';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';

const outcome = (s: RunStep) => {
  const f = s.failure;
  if (!f) return 'failed';
  if (f.signal) return `was stopped by ${f.signal}`;
  if (f.exitCode == null) return 'could not start';
  return `failed with exit code ${f.exitCode}`;
};

/** The failed step's lines up to and including the first error line, the last few of them. */
function failureExcerpt(lines: LogLine[] | null, stepIndex: number, substep?: string): { excerpt: LogLine[]; first: LogLine | null } {
  if (!lines) return { excerpt: [], first: null };
  const mine = lines.filter((l) => l.stepIndex === stepIndex && (!substep || l.substep === substep || !!l.substep?.startsWith(`${substep}.`)));
  const at = mine.findIndex((l) => l.level === 'error');
  // Older runs have no levels: their last lines are the best guess.
  const end = at >= 0 ? at + 1 : mine.length;
  const firstErr = mine.slice(0, end).findIndex((l) => l.stream === 'stderr');
  return { excerpt: mine.slice(Math.max(0, end - 6), end), first: mine[firstErr >= 0 ? firstErr : at] ?? null };
}

export function FailureCard({ run, index, lines, canRun, onRerunFrom, onRerunAll, onJump }: {
  run: BuildHistoryEntry;
  /** The failed step's index in run.steps. */
  index: number;
  lines: LogLine[] | null;
  canRun: boolean;
  onRerunFrom: (step: string) => void;
  onRerunAll: () => void;
  onJump: (line: LogLine) => void;
}) {
  const step = run.steps[index];
  const f = step.failure;
  const counted = run.steps.filter((s) => s.type !== 'action');
  const n = counted.indexOf(step) + 1;
  const before = counted.slice(0, n - 1);
  const passed = before.length > 0 && before.every((s) => s.status === 'success' || s.status === 'skipped');
  const ran = f?.durationMs ?? step.duration;
  const where = f?.substep ? `${f.substepName ?? f.substep}` : step.name;
  const { excerpt, first } = failureExcerpt(lines, index, f?.substep);
  const lastPassed = [...before].reverse().find((s) => s.status === 'success');
  const fallback = !f && run.error ? run.error : null;

  return (
    <section role="alert" className="overflow-hidden rounded-card border border-fail-line bg-surface shadow-e1">
      <div className="flex items-start gap-3.5 px-4 py-4 sm:px-[18px]">
        <span className="grid size-10 shrink-0 place-items-center rounded-box border border-fail-line bg-fail-soft text-fail"><CircleX className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold">{where} {outcome(step)}</h2>
          <p className="mt-0.5 text-[13.5px] text-fg-2">
            Step {n} of {counted.length}{f?.substep ? ` (${step.name}, substep ${f.substep})` : ''}
            {ran != null ? ` · ran for ${formatDurationCompact(ran)}` : ''}
            {passed ? ` · steps 1 to ${n - 1} passed${lastPassed ? `, including ${lastPassed.name}` : ''}` : ''}
          </p>
          {f?.meaning && <p className="mt-1 text-[13.5px] text-fg">{f.meaning.charAt(0).toUpperCase() + f.meaning.slice(1)}</p>}
          {fallback && <p className="mt-1 break-words font-mono text-[12.5px] text-fg-2">{fallback}</p>}
        </div>
        {first && (
          <button type="button" onClick={() => onJump(first)} className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-primary-hi hover:underline max-sm:hidden">
            Jump to the error<ChevronDown className="size-3.5" />
          </button>
        )}
      </div>

      {f && (f.cwd || f.shell || f.command) && (
        <dl className="flex flex-wrap gap-x-[18px] gap-y-1.5 px-4 pb-3.5 font-mono text-[12.5px] text-fg-2 sm:pl-[72px] sm:pr-[18px]">
          {f.cwd && <Fact k="folder" v={f.cwd} />}
          {f.shell && <Fact k="shell" v={f.shell} />}
          <Fact k={f.signal ? 'signal' : 'exit'} v={f.signal ?? (f.exitCode == null ? 'did not start' : String(f.exitCode))} />
          {ran != null && <Fact k="ran for" v={formatDurationCompact(ran)} />}
          {f.command && <Fact k="command" v={f.command.split('\n')[0] + ((f.commandLines ?? 1) > 1 ? ` … (${f.commandLines} lines)` : '')} />}
        </dl>
      )}

      {f && (f.unset.length > 0 || f.empty.length > 0) && (
        <div className="mx-4 mb-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-box border border-warn-line bg-warn-soft px-3 py-2 text-[13px] sm:ml-[72px] sm:mr-[18px]">
          <AlertTriangle className="size-3.5 shrink-0 text-warn" />
          <span className="min-w-0 flex-1">
            {f.unset.length > 0 && <><Names list={f.unset} /> {f.unset.length === 1 ? 'is' : 'are'} used by this step, but no env layer sets {f.unset.length === 1 ? 'it' : 'them'}, so the shell read {f.unset.length === 1 ? 'it' : 'them'} as empty. </>}
            {f.empty.length > 0 && <><Names list={f.empty} /> {f.empty.length === 1 ? 'is' : 'are'} set, but to an empty value.</>}
          </span>
          <Link to={`/pipelines/${encodeURIComponent(run.pipelineId)}/environment`} className="text-[13px] font-medium text-primary-hi hover:underline">Open Environment</Link>
        </div>
      )}

      {excerpt.length > 0 ? (
        <div className="border-y border-line bg-log-bg py-2 font-mono text-[12.5px] leading-[1.6] text-log-fg">
          {excerpt.map((l, i) => (
            <div key={l.id ?? i} className={cx('px-4 sm:px-[18px] whitespace-pre-wrap break-words',
              l.level === 'error' || l === first ? 'bg-fail-soft text-fail' : l.stream === 'stderr' ? 'text-warn' : l.stream === 'system' && 'text-fg-3')}>
              <Ansi>{l.text}</Ansi>
            </div>
          ))}
        </div>
      ) : f && f.lastLines.length > 0 ? (
        <div className="border-y border-line bg-log-bg py-2 font-mono text-[12.5px] leading-[1.6] text-fail">
          {f.lastLines.map((t, i) => <div key={i} className="whitespace-pre-wrap break-words px-4 sm:px-[18px]">{t}</div>)}
        </div>
      ) : null}

      {canRun && (
        <div className="flex flex-wrap items-center gap-2 bg-bg-2 px-4 py-3 sm:px-[18px]">
          {step.type !== 'approval' && <Button variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={() => onRerunFrom(step.name)}>Re-run from {step.name}</Button>}
          <Button icon={<Play className="size-3.5" />} onClick={onRerunAll}>Re-run all</Button>
          {n > 1 && <span className="ml-auto text-[13px] text-fg-3 max-md:w-full">Re-run from {step.name} reuses this run&rsquo;s workspace. {n === 2 ? 'Step 1 is' : `Steps 1 to ${n - 1} are`} not repeated.</span>}
        </div>
      )}
    </section>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <div className="flex min-w-0 gap-2"><dt className="text-fg-3">{k}</dt><dd className="min-w-0 break-all text-fg-2">{v}</dd></div>;
}

function Names({ list }: { list: string[] }) {
  return <>{list.map((n, i) => <span key={n}>{i > 0 && (i === list.length - 1 ? ' and ' : ', ')}<b className="font-mono text-[12.5px] font-semibold text-warn">{n}</b></span>)}</>;
}
