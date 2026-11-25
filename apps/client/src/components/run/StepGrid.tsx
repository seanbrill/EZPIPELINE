/**
 * The step grid (design sheet section 10b, f66 and f116).
 *
 * v1's best idea, kept: every step of a run is its own tile, all visible at
 * once, each with its name, status, time and a bar. v2 makes it calmer (done
 * tiles stay quiet; what is moving or broken is the only thing that glows) and
 * recursive: a tile with substeps shows them as a segmented bar and an "n/m"
 * count, and opening it shows the same grid one level down.
 *
 * The same component is used at every zoom level and on every screen.
 */
import type { ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';
import { cx } from '../ui/cx';
import { StepIcon, STEP_FILL } from './status';
import type { StepState } from './status';

export interface TileModel {
  key: string;
  /** "07", or "11.2" when zoomed in. */
  number: string;
  name: string;
  state: StepState;
  /** "3.9s", "1m 12s", "—". Counting while running. */
  time?: string;
  /** 0..1 when the step can say how far along it is. */
  progress?: number | null;
  /** e.g. "312 of 540 MB", under the name of a running tile. */
  detail?: string;
  /** The states of its children, when it has any. */
  substeps?: StepState[];
  /** "Retry from here", "Promote", etc.: a control at the foot of the tile. */
  action?: ReactNode;
}

interface StepGridProps {
  tiles: TileModel[];
  selected?: string | null;
  onSelect?: (key: string) => void;
  /** Called for tiles that have substeps; the parent zooms in. */
  onOpen?: (key: string) => void;
  className?: string;
  /** Two columns on a phone; desktop fills with 148px minimum tiles. */
  minTile?: number;
}

export function StepGrid({ tiles, selected, onSelect, onOpen, className, minTile = 148 }: StepGridProps) {
  return (
    <ol
      className={cx('grid gap-2 max-sm:!grid-cols-2', className)}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minTile}px, 1fr))` }}
      aria-label="Steps"
    >
      {tiles.map((t) => (
        <li key={t.key} className="min-w-0" data-key={t.key}>
          <StepTile tile={t} selected={selected === t.key} onSelect={onSelect} onOpen={onOpen} />
        </li>
      ))}
    </ol>
  );
}

function subCount(states: StepState[]) {
  // "2/4" means "on substep 2 of 4", like "step 11 of 20" elsewhere: the
  // running one counts, so the number agrees with what the zoomed view shows.
  const done = states.filter((s) => s === 'done').length;
  const running = states.some((s) => s === 'running') ? 1 : 0;
  return `${Math.min(states.length, done + running)}/${states.length}`;
}

export function StepTile({ tile, selected, onSelect, onOpen }: { tile: TileModel; selected?: boolean; onSelect?: (k: string) => void; onOpen?: (k: string) => void }) {
  const { state, substeps } = tile;
  const hasSubs = !!substeps && substeps.length > 0;
  const open = () => (hasSubs && onOpen ? onOpen(tile.key) : onSelect?.(tile.key));
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      aria-label={`${tile.number} ${tile.name}${hasSubs ? `, ${substeps!.length} substeps` : ''}`}
      aria-pressed={selected || undefined}
      className={cx(
        'group/tile relative flex min-h-[104px] cursor-pointer flex-col overflow-hidden rounded-box border bg-surface-2 px-3 pt-3 text-left',
        'transition-[border-color,box-shadow,transform] duration-[var(--dur-fast)] hover:-translate-y-px hover:border-line-3',
        state === 'running' && 'border-run-line shadow-[0_0_0_1px_var(--run-line),0_8px_24px_-10px_rgba(56,189,248,.45)]',
        state === 'failed' && 'border-fail-line bg-[color-mix(in_srgb,var(--fail)_6%,var(--surface-2))]',
        state === 'approval' && 'border-warn-line',
        !['running', 'failed', 'approval'].includes(state) && 'border-line',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-bg',
      )}
    >
      <div className="flex items-center gap-2">
        <StepIcon state={state} />
        <span className="ml-auto font-mono text-[11.5px] text-fg-3">{tile.number}</span>
        {hasSubs && <Maximize2 className="size-3.5 text-fg-3 transition-colors group-hover/tile:text-fg" aria-hidden="true" />}
      </div>
      <p className="mt-2 line-clamp-3 text-[13px] font-medium leading-[1.35] text-fg">{tile.name}</p>
      {tile.detail && <p className="mt-1 font-mono text-[11.5px] text-run">{tile.detail}</p>}
      <div className="mt-auto flex items-center gap-2 pb-2 pt-2">
        <span className={cx('font-mono text-[12px]', state === 'running' ? 'text-run' : 'text-fg-2')}>{tile.time ?? '—'}</span>
        {hasSubs && (
          <span className="ml-auto font-mono text-[11.5px] text-fg-3 group-hover/tile:hidden">{subCount(substeps!)}</span>
        )}
        {hasSubs && (
          <span className="ml-auto hidden whitespace-nowrap text-[11.5px] text-fg-2 group-hover/tile:inline">Open {substeps!.length} substeps</span>
        )}
        {tile.action && <span className="ml-auto">{tile.action}</span>}
      </div>
      <TileBar state={state} progress={tile.progress} substeps={substeps} />
    </div>
  );
}

/** The 3px bar flush with a tile's bottom edge. */
function TileBar({ state, progress, substeps }: { state: StepState; progress?: number | null; substeps?: StepState[] }) {
  if (substeps && substeps.length > 0) {
    return (
      <span className="-mx-3 flex h-[3px] gap-[2px]" aria-hidden="true">
        {substeps.map((s, i) => (
          <span key={i} className={cx('flex-1', STEP_FILL[s], s === 'running' && 'tile-sheen')} />
        ))}
      </span>
    );
  }
  if (state === 'running') {
    return (
      <span className="-mx-3 block h-[3px] bg-run-soft" aria-hidden="true">
        <span
          className="tile-sheen block h-full bg-run transition-[width] duration-[var(--dur-slow)]"
          style={{ width: progress != null ? `${Math.max(4, progress * 100)}%` : '35%' }}
        />
      </span>
    );
  }
  return <span className={cx('-mx-3 block h-[3px]', STEP_FILL[state])} aria-hidden="true" />;
}

/**
 * One segment per step: the whole run in one line (the collapsed run card, a
 * run row, the minimap). `outline` draws a box round a range, for the minimap's
 * "you are here".
 */
export function RunSegments({ states, outline, className }: { states: StepState[]; outline?: [number, number]; className?: string }) {
  return (
    <span className={cx('relative flex h-1.5 gap-[3px]', className)} aria-hidden="true">
      {states.map((s, i) => (
        <span key={i} className={cx('flex-1 rounded-[2px]', STEP_FILL[s], s === 'approval' && 'run-attention')} />
      ))}
      {outline && (
        <span
          className="absolute -inset-y-1 rounded-[4px] border border-fg"
          style={{ left: `${(outline[0] / states.length) * 100}%`, width: `${((outline[1] - outline[0] + 1) / states.length) * 100}%` }}
        />
      )}
    </span>
  );
}
