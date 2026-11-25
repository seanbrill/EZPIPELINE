/**
 * The step grid with zoom (design sheet f132–f137).
 *
 * At the top it is v1's grid of steps. A tile with substeps opens into the
 * same grid one level down: a breadcrumb says where you are, a minimap shows
 * every level above with the part you are inside outlined, and Esc goes back
 * up. The page scopes its log to whatever is open or selected here.
 */
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from '../ui/cx';
import { Kbd } from '../ui/Badge';
import { StepGrid, RunSegments } from './StepGrid';
import type { TileModel } from './StepGrid';
import { childTiles, childrenOf, substepState } from './model';
import { STEP_FILL } from './status';
import type { StepState } from './status';
import type { BuildHistoryEntry, Substep } from '../../types/build';

/** "2.2.1" → ["2", "2.2", "2.2.1"] */
const ancestry = (path: string) => path.split('.').map((_, i, a) => a.slice(0, i + 1).join('.'));
const parentOf = (path: string) => (path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : null);

interface Props {
  run: BuildHistoryEntry;
  now: number;
  subs: Substep[];
  /** The top-level tiles (tilesFor). */
  tiles: TileModel[];
  /** The node whose children are shown ("2", "2.2"), or null for the run's steps. */
  zoom: string | null;
  /** The selected tile's key at this level: a step index at the top, a path below. */
  selected: string | null;
  onZoom: (path: string | null) => void;
  onSelect: (key: string | null) => void;
}

export function nameOfPath(run: BuildHistoryEntry, subs: Substep[], path: string): string {
  if (!path.includes('.')) return run.steps[Number(path) - 1]?.name ?? `Step ${path}`;
  return subs.find((s) => s.path === path)?.name ?? path;
}

export function StepZoom({ run, now, subs, tiles, zoom, selected, onZoom, onSelect }: Props) {
  const [anim, setAnim] = useState<{ dir: 'in' | 'out'; origin: string } | null>(null);

  // The top-level tiles take their segments from the live tree when it has them,
  // so a running step's bar moves without waiting for the history to refresh.
  const top = tiles.map((t) => {
    const kids = childrenOf(subs, String(Number(t.key) + 1));
    return kids.length ? { ...t, substeps: kids.map(substepState) } : t;
  });
  const shown = zoom ? childTiles(subs, zoom, now) : top;

  const go = (path: string | null, from?: string) => {
    let origin = '50% 0';
    if (from) {
      const grid = document.querySelector('[data-zoom-grid]');
      const tile = grid?.querySelector(`[data-key="${CSS.escape(from)}"]`);
      if (grid && tile) {
        const g = grid.getBoundingClientRect();
        const r = tile.getBoundingClientRect();
        origin = `${r.left + r.width / 2 - g.left}px ${r.top + r.height / 2 - g.top}px`;
      }
    }
    setAnim({ dir: from ? 'in' : 'out', origin });
    onZoom(path);
  };

  // Esc goes up a level, unless something else on the page has it.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('[role="dialog"]'))) return;
      e.preventDefault();
      setAnim({ dir: 'out', origin: '50% 0' });
      onZoom(parentOf(zoom));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom, onZoom]);

  const levels = zoom ? ancestry(zoom) : [];
  const done = shown.filter((t) => t.state === 'done').length;

  return (
    <div>
      <div className="mb-2.5 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
        {zoom ? (
          <nav aria-label="Substep level" className="flex min-w-0 flex-wrap items-center gap-1 text-[13.5px]">
            <Crumb state={null} onClick={() => go(null)}>Run #{run.buildNumber}</Crumb>
            {levels.map((p, i) => {
              const sub = subs.find((s) => s.path === p);
              const state: StepState = sub ? substepState(sub) : (top.find((t) => String(Number(t.key) + 1) === p)?.state ?? 'waiting');
              return (
                <span key={p} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="size-3.5 shrink-0 text-fg-3" aria-hidden="true" />
                  <Crumb state={state} current={i === levels.length - 1} onClick={i === levels.length - 1 ? undefined : () => go(p)}>
                    {nameOfPath(run, subs, p)}
                  </Crumb>
                </span>
              );
            })}
            <span className="ml-1 rounded-full border border-line px-2 py-0.5 font-mono text-[11.5px] text-fg-3">Level {levels.length + 1}</span>
          </nav>
        ) : (
          <h2 className="text-[15px] font-semibold">Steps <span className="font-mono text-[12.5px] font-normal text-fg-3">{done}/{shown.length}</span></h2>
        )}
        <span className="ml-auto flex items-center gap-3 text-[12.5px] text-fg-2">
          {selected !== null && <button type="button" className="hover:text-fg" onClick={() => onSelect(null)}>{zoom ? 'Show this level’s output' : 'Show all steps’ output'}</button>}
          {zoom && <span className="flex items-center gap-1.5 text-fg-3 max-sm:hidden"><Kbd>Esc</Kbd> up a level</span>}
        </span>
      </div>

      {zoom && (
        <div className="mb-3 flex flex-col gap-2.5 rounded-box border border-line bg-surface px-3 py-2.5">
          {levels.map((p, i) => {
            const parent = i === 0 ? null : levels[i - 1];
            const row = parent ? childrenOf(subs, parent) : null;
            const states = row ? row.map(substepState) : top.map((t) => t.state);
            const at = row ? row.findIndex((s) => s.path === p) : top.findIndex((t) => String(Number(t.key) + 1) === p);
            return (
              <button key={p} type="button" onClick={() => go(parent)} className="group flex items-center gap-3 text-left" title={parent ? `Back to ${nameOfPath(run, subs, parent)}` : 'Back to the run'}>
                <span className="w-28 shrink-0 truncate font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3 group-hover:text-fg-2">
                  {parent ? `${parent} · ${states.length} sub` : `Run · ${states.length} steps`}
                </span>
                <RunSegments className="flex-1" states={states} outline={at >= 0 ? [at, at] : undefined} />
              </button>
            );
          })}
        </div>
      )}

      <div key={zoom ?? 'run'} data-zoom-grid className={cx(anim && (anim.dir === 'in' ? 'zoom-in' : 'zoom-out'))} style={anim ? ({ '--zo': anim.origin } as React.CSSProperties) : undefined}>
        {shown.length === 0 ? (
          <p className="rounded-box border border-dashed border-line px-4 py-6 text-center text-[13px] text-fg-3">This level has no substeps yet. They appear as the step reports them.</p>
        ) : (
          <StepGrid tiles={shown} selected={selected}
            onSelect={(k) => onSelect(selected === k ? null : k)}
            onOpen={(k) => go(zoom ? k : String(Number(k) + 1), k)} />
        )}
      </div>
    </div>
  );
}

function Crumb({ state, current, onClick, children }: { state: StepState | null; current?: boolean; onClick?: () => void; children: React.ReactNode }) {
  const body = (
    <>
      {state && <span className={cx('size-2 shrink-0 rounded-full', STEP_FILL[state])} aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </>
  );
  if (!onClick) return <span aria-current={current ? 'location' : undefined} className="flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-ctl border border-line-2 bg-surface-2 px-2 py-0.5 font-medium text-fg">{body}</span>;
  return <button type="button" onClick={onClick} className="flex min-w-0 max-w-[14rem] items-center gap-1.5 rounded-ctl px-1.5 py-0.5 text-fg-2 hover:bg-surface-2 hover:text-fg">{body}</button>;
}
