/**
 * Run and step status: the words, the colours and the icons, defined once.
 *
 * A run's status as the server writes it is not always what a person needs to
 * read. "paused" is a run waiting on somebody, so it reads "Needs you"; a
 * "failed" run whose only failures were allowed to fail (continueOnError) is a
 * "Warning", not a red row.
 */
import { Check, Minus, ShieldAlert, X } from 'lucide-react';
import type { BuildHistoryEntry, RunStep } from '../../types/build';
import { Badge } from '../ui/Badge';
import type { Tone } from '../ui/Badge';
import { cx } from '../ui/cx';

export type RunState = 'queued' | 'starting' | 'running' | 'approval' | 'success' | 'warning' | 'failed' | 'aborted';
export type StepState = 'done' | 'running' | 'failed' | 'approval' | 'waiting' | 'aborted' | 'skipped';

export function runState(b: Pick<BuildHistoryEntry, 'status' | 'steps'>): RunState {
  switch (b.status) {
    case 'running':
      return b.steps.some((s) => s.status !== 'pending') ? 'running' : 'starting';
    case 'paused':
      return 'approval';
    case 'success':
      return 'success';
    case 'aborted':
      return 'aborted';
    case 'failed':
    case 'error': {
      const failed = b.steps.filter((s) => s.status === 'failed' || s.status === 'error');
      return failed.length > 0 && failed.every((s) => s.continueOnError) ? 'warning' : 'failed';
    }
    default:
      return 'queued';
  }
}

export function stepState(s: RunStep, run?: Pick<BuildHistoryEntry, 'status' | 'activeStep'>): StepState {
  // A gate the run is parked on is not "waiting" or "running": it is waiting on you.
  // The server marks it running while it waits, so this comes before the status.
  if (run?.status === 'paused' && s.type === 'approval' && s.status !== 'success' && (run.activeStep === s.name || !run.activeStep)) return 'approval';
  switch (s.status) {
    case 'success':
      return 'done';
    case 'running':
      return 'running';
    case 'failed':
    case 'error':
      return 'failed';
    case 'aborted':
      return 'aborted';
    case 'skipped':
      return 'skipped';
    default:
      // A gate the run is parked on is not "waiting", it is waiting on you.
      if (run?.status === 'paused' && s.type === 'approval' && (run.activeStep === s.name || !run.activeStep)) return 'approval';
      return 'waiting';
  }
}

export const RUN_LABEL: Record<RunState, string> = {
  queued: 'Queued',
  starting: 'Starting',
  running: 'Running',
  approval: 'Needs you',
  success: 'Succeeded',
  warning: 'Warning',
  failed: 'Failed',
  aborted: 'Cancelled',
};

export const RUN_TONE: Record<RunState, Tone> = {
  queued: 'neutral',
  starting: 'run',
  running: 'run',
  approval: 'warn',
  success: 'ok',
  warning: 'warn',
  failed: 'fail',
  aborted: 'neutral',
};

export function RunStatusBadge({ state, children }: { state: RunState; children?: React.ReactNode }) {
  return (
    <Badge tone={RUN_TONE[state]} dot live={state === 'running' || state === 'starting'}>
      {children ?? RUN_LABEL[state]}
    </Badge>
  );
}

/** The colour of a bar segment, a tile's bottom edge, a minimap cell. */
export const STEP_FILL: Record<StepState, string> = {
  done: 'bg-primary',
  running: 'bg-run',
  failed: 'bg-fail',
  approval: 'bg-warn',
  waiting: 'bg-surface-3',
  aborted: 'bg-line-3',
  skipped: 'bg-line-2',
};

/** The 16–18px round icon at the top of a step tile (f66). */
export function StepIcon({ state, size = 18, className }: { state: StepState; size?: number; className?: string }) {
  const box = { width: size, height: size };
  const glyph = Math.round(size * 0.62);
  switch (state) {
    case 'done':
      return (
        <span style={box} className={cx('grid shrink-0 place-items-center rounded-full bg-primary text-primary-ink', className)}>
          <Check strokeWidth={3.2} style={{ width: glyph, height: glyph }} />
          <span className="sr-only">Done</span>
        </span>
      );
    case 'failed':
      return (
        <span style={box} className={cx('grid shrink-0 place-items-center rounded-full bg-fail text-[#2a0a10]', className)}>
          <X strokeWidth={3.2} style={{ width: glyph, height: glyph }} />
          <span className="sr-only">Failed</span>
        </span>
      );
    case 'running':
      return (
        <span style={box} className={cx('shrink-0 rounded-full border-2 border-run-line border-t-run border-r-run motion-safe:animate-spin', className)}>
          <span className="sr-only">Running</span>
        </span>
      );
    case 'approval':
      return (
        <span style={box} className={cx('grid shrink-0 place-items-center text-warn', className)}>
          <ShieldAlert style={{ width: size, height: size }} />
          <span className="sr-only">Waiting for approval</span>
        </span>
      );
    case 'aborted':
    case 'skipped':
      return (
        <span style={box} className={cx('grid shrink-0 place-items-center rounded-full bg-line-2 text-fg-3', className)}>
          <Minus strokeWidth={3} style={{ width: glyph, height: glyph }} />
          <span className="sr-only">{state === 'aborted' ? 'Cancelled' : 'Skipped'}</span>
        </span>
      );
    default:
      return (
        <span style={box} className={cx('shrink-0 rounded-full border-[1.5px] border-line-3', className)}>
          <span className="sr-only">Waiting</span>
        </span>
      );
  }
}

/** Is this run started by a person, or by a watch or a schedule? */
export function triggerOf(triggeredBy: string | undefined): { kind: 'auto' | 'schedule' | 'person'; label: string } {
  const t = (triggeredBy ?? '').trim();
  if (/^git watch/i.test(t)) return { kind: 'auto', label: 'auto' };
  if (/^schedule/i.test(t)) return { kind: 'schedule', label: 'schedule' };
  if (!t || t === 'manual') return { kind: 'person', label: 'manual' };
  return { kind: 'person', label: t };
}
