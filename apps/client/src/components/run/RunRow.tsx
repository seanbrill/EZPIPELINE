/**
 * One run in a list (design sheet f138 desktop row, f139 phone card). The
 * commit is on every row from the moment it is known.
 */
import { Link } from 'react-router-dom';
import { format, isToday, isYesterday } from 'date-fns';
import type { BuildHistoryEntry } from '../../types/build';
import { useLive } from '../../contexts/LiveContext';
import { formatDurationCompact } from '../../helpers/formatDuration';
import { cx } from '../ui/cx';
import { CommitChip } from './CommitChip';
import { RunSegments } from './StepGrid';
import { RunStatusBadge, runState, triggerOf } from './status';
import { branchOf, runElapsed, stepStates, useNow } from './model';

export function TriggerPill({ triggeredBy }: { triggeredBy?: string }) {
  const t = triggerOf(triggeredBy);
  const b = branchOf(triggeredBy);
  return (
    <span className={cx('inline-flex h-[22px] items-center whitespace-nowrap rounded-full border px-2 text-[12px]',
      t.kind === 'auto' ? 'border-auto-line bg-auto-soft text-auto' : 'border-line-2 text-fg-2')}>
      {t.kind === 'auto' ? `watch · ${b ?? 'branch'}` : t.kind === 'schedule' ? (triggeredBy ?? 'schedule') : t.label}
    </span>
  );
}

/** The commit a run carries: its own record, or what a watch resolved for its sha. */
export function useRunCommit(r: BuildHistoryEntry | undefined) {
  const { resolved } = useLive();
  if (!r) return null;
  const c = r.commits?.[0];
  if (c) return c;
  if (r.commitSha && resolved[r.commitSha]) return resolved[r.commitSha];
  return null;
}

export function whenLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return `Yesterday ${format(d, 'HH:mm')}`;
  return format(d, 'd MMM HH:mm');
}

export function RunCommitLine({ r, twoLine }: { r: BuildHistoryEntry; twoLine?: boolean }) {
  const c = useRunCommit(r);
  const branch = branchOf(r.triggeredBy);
  if (!c && !r.commitSha) return <span className="text-[13px] text-fg-3">No commit recorded</span>;
  return (
    <span className={cx('flex min-w-0 gap-2', twoLine ? 'flex-col items-start gap-1.5' : 'items-center')}>
      <CommitChip sha={c?.sha ?? r.commitSha ?? ''} branch={branch ?? undefined} />
      {c ? <span className={cx('min-w-0 text-fg', twoLine ? 'line-clamp-2 text-[14px] leading-snug' : 'truncate text-[13.5px]')}>{c.subject}</span>
        : <span className="text-[13px] text-fg-3">Resolving commit…</span>}
    </span>
  );
}

export function RunRow({ r, showGroup = true }: { r: BuildHistoryEntry; showGroup?: boolean }) {
  const state = runState(r);
  const live = state === 'running' || state === 'starting' || state === 'approval';
  const now = useNow(live);
  const el = runElapsed(r, now);
  const failedAt = state === 'failed' ? r.steps.find((s) => (s.status === 'failed' || s.status === 'error') && !s.continueOnError)?.name : null;
  return (
    <Link to={`/runs/${r.id}`}
      className={cx('grid grid-cols-[118px_220px_minmax(0,1fr)_112px_92px_118px] items-center gap-4 border-b border-line px-[18px] py-2.5 text-[13.5px] hover:bg-surface-2',
        state === 'approval' && 'shadow-[inset_3px_0_0_var(--warn)]')}>
      <span><RunStatusBadge state={state} /></span>
      <span className="min-w-0">
        <span className="flex items-baseline gap-1.5"><b className="truncate font-semibold">{r.pipelineName}</b><span className="font-mono text-[12.5px] text-fg-3">#{r.buildNumber}</span></span>
        {showGroup && <span className="block truncate text-[12px] text-fg-3">{r.group}</span>}
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <RunCommitLine r={r} />
        <span><TriggerPill triggeredBy={r.triggeredBy} /></span>
      </span>
      <RunSegments states={stepStates(r)} />
      <span className="flex flex-col font-mono text-[12.5px]">
        {el != null ? formatDurationCompact(el) : '—'}
        <small className="font-sans text-[11.5px] text-fg-3">{state === 'approval' ? 'waiting' : failedAt ? `at ${failedAt}` : live ? 'live' : ''}</small>
      </span>
      <span className="text-right font-mono text-[12px] text-fg-3">{whenLabel(r.startTime)}</span>
    </Link>
  );
}

export function RunCard({ r }: { r: BuildHistoryEntry }) {
  const state = runState(r);
  const live = state === 'running' || state === 'starting' || state === 'approval';
  const now = useNow(live);
  const el = runElapsed(r, now);
  return (
    <Link to={`/runs/${r.id}`} className={cx('flex flex-col gap-2.5 rounded-[14px] border bg-surface p-3.5 active:bg-surface-2', state === 'approval' ? 'border-warn-line' : 'border-line')}>
      <span className="flex min-w-0 items-center gap-1.5">
        <b className="truncate text-[16px] font-semibold">{r.pipelineName}</b>
        <span className="font-mono text-[13px] text-fg-3">#{r.buildNumber}</span>
        <span className="flex-1" />
        <RunStatusBadge state={state} />
      </span>
      <RunCommitLine r={r} twoLine />
      <RunSegments states={stepStates(r)} />
      <span className="flex items-center gap-2.5 text-[13px] text-fg-3">
        <TriggerPill triggeredBy={r.triggeredBy} />
        <span>{el != null ? formatDurationCompact(el) : ''}{state === 'approval' ? ' · waiting' : ''}</span>
        <span className="flex-1" />
        <span className="font-mono">{whenLabel(r.startTime).replace('Yesterday ', '')}</span>
      </span>
    </Link>
  );
}
