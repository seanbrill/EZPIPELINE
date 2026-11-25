/**
 * Derived views of the live history that more than one screen needs.
 */
import { useMemo } from 'react';
import { useLive } from '../../contexts/LiveContext';
import type { BuildHistoryEntry, PipelineInfo } from '../../types/build';
import { runState } from '../run/status';
import type { RunState } from '../run/status';

export interface GroupSummary {
  name: string;
  pipelines: number;
  last: RunState | null;
}

/** Newest first, whatever order the server sent. */
export function sortRuns(runs: BuildHistoryEntry[]) {
  return [...runs].sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
}

export function useRunsSummary() {
  const { history, pipelines } = useLive();
  return useMemo(() => {
    const runs = sortRuns(history);
    const live = runs.filter((r) => r.status === 'running').length;
    const waiting = runs.filter((r) => r.status === 'paused').length;
    const lastByPipeline = new Map<string, BuildHistoryEntry>();
    for (const r of runs) if (!lastByPipeline.has(r.pipelineId)) lastByPipeline.set(r.pipelineId, r);

    const groups = new Map<string, GroupSummary>();
    for (const p of pipelines) {
      const name = (p.group ?? '').split('/')[0] || 'Ungrouped';
      const g = groups.get(name) ?? { name, pipelines: 0, last: null };
      g.pipelines += 1;
      const lr = lastByPipeline.get(p.id);
      if (lr) {
        const s = runState(lr);
        // A group shows its worst current state: failed beats waiting beats running beats ok.
        const rank = (x: RunState | null) => (x === 'failed' ? 4 : x === 'approval' ? 3 : x === 'running' || x === 'starting' ? 2 : x ? 1 : 0);
        if (rank(s) > rank(g.last)) g.last = s;
      }
      groups.set(name, g);
    }
    return { runs, live, waiting, lastByPipeline, groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }, [history, pipelines]);
}

/** Every group path, parents included ("A", "A/B"), for group pickers. */
export function allGroups(pipelines: PipelineInfo[]) {
  const out = new Set<string>();
  for (const p of pipelines) {
    const parts = (p.group ?? '').split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return [...out].sort();
}
