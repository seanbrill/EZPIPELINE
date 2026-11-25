/**
 * A run's output, live (design sheet f65, f66, f76).
 *
 * Loads what is stored, then appends lines from the stream. Shows one step's
 * lines when a step is selected. Follows the bottom only while the reader is
 * at the bottom: scrolling up to read stops it, and "Jump to latest" brings
 * it back. It scrolls its own box, never the page (v1's scrollIntoView
 * dragged the whole page down while a build streamed).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Ansi from 'ansi-to-react';
import { ArrowDown, Copy, Download, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useLive } from '../../contexts/LiveContext';
import { useToast } from '../../contexts/ToastContext';
import type { LogLine } from '../../types/build';
import { IconButton } from '../ui/Button';
import { Input } from '../ui/Field';
import { Skeleton } from '../ui/Feedback';
import { cx } from '../ui/cx';

const MAX_LINES = 20_000;

export function useRunLog(buildId: string, finished: boolean) {
  const { onLine } = useLive();
  const [lines, setLines] = useState<LogLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const early: LogLine[] = [];
    let loaded = false;
    const off = onLine((l) => {
      if (l.buildId !== buildId) return;
      if (!loaded) { early.push(l); return; }
      setLines((prev) => {
        const next = [...(prev ?? []), l];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });
    api<{ lines?: { id: number; text: string; at: string; stepIndex: number | null; stream: LogLine['stream']; substep?: string | null; level?: string }[]; logs: string[] }>(`/builds/${buildId}/logs`)
      .then((r) => {
        if (cancelled) return;
        const stored: LogLine[] = r.lines
          ? r.lines.map((l) => ({ ...l, buildId, text: l.stream === 'system' || l.stream == null ? edgeTrim(l.text) : l.text }))
          : r.logs.map((t) => ({ buildId, text: edgeTrim(t), stepIndex: null, stream: null }));
        // Lines that arrived while loading and are not already stored.
        const tail = new Set(stored.slice(-200).map((l) => `${l.stepIndex}|${l.text}`));
        loaded = true;
        setLines([...stored, ...early.filter((l) => !tail.has(`${l.stepIndex}|${l.text}`))]);
      })
      .catch((e) => { if (!cancelled) { loaded = true; setError((e as Error).message); setLines([]); } });
    return () => { cancelled = true; off(); };
  }, [buildId, onLine, finished]);

  return { lines, error };
}

/** Runs from before v2 stored EZPipeline's messages with a newline either side. */
const edgeTrim = (t: string) => t.replace(/^\s*\n|\n\s*$/g, '');

export function LogView({ lines, error, step, scope = null, stepName, className, fileName, focus = null }: { lines: LogLine[] | null; error?: string | null; step: number | null; /** A substep path: only its lines and its children's. */ scope?: string | null; stepName?: string; className?: string; fileName: string; /** A line to scroll to and mark ({ line, n } with n changing on each press). */ focus?: { line: LogLine; n: number } | null }) {
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [filter, setFilter] = useState('');

  const shown = useMemo(() => {
    let l = lines ?? [];
    if (step !== null) l = l.filter((x) => x.stepIndex === step);
    if (scope) l = l.filter((x) => x.substep === scope || !!x.substep?.startsWith(`${scope}.`));
    if (filter.trim()) {
      const f = filter.toLowerCase();
      l = l.filter((x) => x.text.toLowerCase().includes(f));
    }
    return l;
  }, [lines, step, scope, filter]);

  useEffect(() => {
    if (pinned && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, pinned]);

  // "Jump to the error": the line, in the middle of the box, and following stops.
  const marked = focus ? shown.indexOf(focus.line) : -1;
  useEffect(() => {
    if (!focus || marked < 0 || !box.current) return;
    setPinned(false);
    const el = box.current.querySelector<HTMLElement>(`[data-n="${marked}"]`);
    if (el) box.current.scrollTop = el.offsetTop - box.current.clientHeight / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n, marked]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const text = () => shown.map((l) => l.text).join('\n');
  return (
    <div className={cx('flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-log-bg', className)}>
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg-2">{stepName ? <>Log · <span className="text-fg">{stepName}</span></> : 'Log · all steps'}<span className="ml-2 font-mono text-[11.5px] text-fg-3">{shown.length} lines</span></span>
        <Input className="w-44 max-sm:hidden" leading={<Search />} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter log" />
        <IconButton label="Copy log" size="sm" onClick={() => { void navigator.clipboard.writeText(text()); toast.success('Log copied'); }}><Copy className="size-4" /></IconButton>
        <IconButton label="Download .log" size="sm" onClick={() => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
          a.download = fileName;
          a.click();
          URL.revokeObjectURL(a.href);
        }}><Download className="size-4" /></IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={box} onScroll={onScroll} className="absolute inset-0 overflow-auto py-2 font-mono text-[length:var(--log-size,12.5px)] leading-[1.6] text-log-fg">
          {lines === null ? (
            <div className="space-y-2 px-4 py-2">{[70, 45, 60, 30].map((w) => <Skeleton key={w} className="h-3" rounded="rounded" />)}</div>
          ) : error ? (
            <p className="px-4 py-3 text-fail">The log could not be loaded: {error}</p>
          ) : shown.length === 0 ? (
            <p className="px-4 py-3 text-fg-3">{filter ? 'No lines match the filter.' : step !== null ? 'This step has not printed anything yet.' : 'Nothing printed yet.'}</p>
          ) : (
            shown.map((l, i) => (
              <div key={l.id ?? `l${i}`} data-n={i} className={cx('flex gap-4 px-4 hover:bg-white/[0.03]',
                l.level === 'error' ? 'bg-fail-soft text-fail' : l.stream === 'stderr' ? 'text-warn' : l.stream === 'system' && 'text-fg-3',
                i === marked && 'shadow-[inset_3px_0_0_var(--fail)]')}>
                <span className="w-10 shrink-0 select-none text-right text-fg-3/60">{i + 1}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words"><Ansi>{l.text}</Ansi></span>
              </div>
            ))
          )}
        </div>
        {!pinned && (
          <button type="button" onClick={() => setPinned(true)}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 px-3 py-1.5 text-[12.5px] text-fg shadow-e2">
            <ArrowDown className="size-3.5" />Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}
