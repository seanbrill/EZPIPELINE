/**
 * Turning a run from the server into what the screens draw.
 */
import { useEffect, useState } from 'react';
import type { BuildHistoryEntry, RunStep, Substep, SubstepSummary } from '../../types/build';
import { formatDurationCompact } from '../../helpers/formatDuration';
import { api } from '../../lib/api';
import { stepState } from './status';
import type { StepState } from './status';
import type { TileModel } from './StepGrid';

/** "git watch main@5ad62f7" → "main". */
export function branchOf(triggeredBy?: string): string | null {
  const m = /git watch\s+([^@\s]+)@/i.exec(triggeredBy ?? '');
  return m ? m[1] : null;
}

/** Re-render every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

export function stepStart(s: RunStep): number | null {
  if (s.startedAt) return s.startedAt;
  return s.startTime ? Date.parse(s.startTime) : null;
}

export function stepElapsed(s: RunStep, now: number): number | null {
  if (s.duration != null) return s.duration;
  const st = stepStart(s);
  return st && s.status === 'running' ? now - st : null;
}

export function runElapsed(r: BuildHistoryEntry, now: number): number | null {
  if (r.duration != null && r.status !== 'running' && r.status !== 'paused') return r.duration;
  const st = Date.parse(r.startTime);
  if (Number.isNaN(st)) return null;
  const end = r.endTime ? Date.parse(r.endTime) : now;
  return end - st;
}

export function stepStates(r: BuildHistoryEntry): StepState[] {
  return r.steps.filter((s) => s.type !== 'action').map((s) => stepState(s, r));
}

export function tilesFor(r: BuildHistoryEntry, now: number): TileModel[] {
  return r.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.type !== 'action')
    .map(({ s, i }, n) => {
      const state = stepState(s, r);
      const el = stepElapsed(s, now);
      const sum = r.substeps?.[String(i + 1)];
      const counter = sum?.unit != null || (sum && !sum.total) ? null : sum;
      let progress = state === 'running' && s.estimatedDuration && el != null ? Math.min(0.97, el / s.estimatedDuration) : null;
      // A step that counts its own work ("::ezp progress 3/10 files") says so under its name.
      if (sum && sum.unit != null && sum.total) progress = sum.done / sum.total;
      return {
        key: String(i),
        number: String(n + 1).padStart(2, '0'),
        name: s.name,
        state,
        time: state === 'approval' ? 'needs you' : el != null ? formatDurationCompact(el) : state === 'waiting' ? '—' : undefined,
        progress,
        detail: sum && sum.unit != null && state === 'running' ? `${sum.done}/${sum.total} ${sum.unit}` : undefined,
        substeps: counter ? summaryStates(counter) : undefined,
      };
    });
}

/** The step a run page should open on: the one running, waiting, or the first failure. */
export function focusStep(r: BuildHistoryEntry): number | null {
  const by = (pred: (s: RunStep) => boolean) => r.steps.findIndex(pred);
  for (const i of [
    by((s) => s.status === 'running'),
    by((s) => s.type === 'approval' && r.status === 'paused' && s.name === r.activeStep),
    by((s) => (s.status === 'failed' || s.status === 'error') && !s.continueOnError),
  ]) if (i >= 0) return i;
  return null;
}

/** A summary's counts as one state per substep, in run order: done, failed, running, then not yet. */
function summaryStates(c: SubstepSummary): StepState[] {
  const rest = Math.max(0, c.total - c.done - c.failed - c.running);
  return [
    ...Array<StepState>(c.done).fill('done'),
    ...Array<StepState>(c.failed).fill('failed'),
    ...Array<StepState>(c.running).fill('running'),
    ...Array<StepState>(rest).fill('waiting'),
  ];
}

export function substepState(s: Substep): StepState {
  return s.status === 'success' ? 'done' : s.status === 'failed' ? 'failed' : s.status === 'running' ? 'running' : 'waiting';
}

/** The direct children of a path ("11" or "11.2"), in order. */
export function childrenOf(subs: Substep[], parent: string): Substep[] {
  const depth = parent.split('.').length + 1;
  return subs
    .filter((s) => s.path.startsWith(`${parent}.`) && s.path.split('.').length === depth)
    .sort((a, b) => Number(a.path.split('.').pop()) - Number(b.path.split('.').pop()));
}

export function childTiles(subs: Substep[], parent: string, now: number): TileModel[] {
  return childrenOf(subs, parent).map((c) => {
    const state = substepState(c);
    const kids = childrenOf(subs, c.path);
    const el = c.startedAt != null ? (c.endedAt ?? (state === 'running' ? now : c.startedAt)) - c.startedAt : null;
    return {
      key: c.path,
      number: c.path,
      name: c.name,
      state,
      time: el != null && c.startedAt != null ? formatDurationCompact(el) : state === 'waiting' ? 'not run' : undefined,
      progress: c.total ? (c.done ?? 0) / c.total : null,
      detail: c.total && state === 'running' ? `${c.done ?? 0}/${c.total}${c.unit ? ` ${c.unit}` : ''}` : undefined,
      substeps: kids.length ? kids.map(substepState) : undefined,
    };
  });
}

/** The run's substep tree: fetched once, then kept current from `substep` events. */
export function useSubsteps(buildId: string, onEvent: (fn: (e: { type: string; buildId?: string; data?: unknown }) => void) => () => void) {
  const [subs, setSubs] = useState<Substep[]>([]);
  useEffect(() => {
    let cancelled = false;
    const early: Substep[] = [];
    let loaded = false;
    const merge = (list: Substep[], s: Substep) => {
      const i = list.findIndex((x) => x.path === s.path);
      if (i < 0) return [...list, s];
      const next = list.slice();
      next[i] = s;
      return next;
    };
    const off = onEvent((e) => {
      if (e.type !== 'substep' || e.buildId !== buildId) return;
      const s = (e.data as { substep?: Substep })?.substep;
      if (!s) return;
      if (!loaded) early.push(s);
      else setSubs((l) => merge(l, s));
    });
    api<{ substeps: Substep[] }>(`/builds/${encodeURIComponent(buildId)}/substeps`)
      .then((r) => {
        if (cancelled) return;
        loaded = true;
        setSubs(early.reduce(merge, r.substeps));
      })
      .catch(() => { loaded = true; });
    return () => { cancelled = true; off(); };
  }, [buildId, onEvent]);
  return subs;
}
