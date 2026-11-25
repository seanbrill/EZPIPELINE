/**
 * The first-pipeline tour (design sheet f17): four coach marks on the
 * pipeline page, opened by setup's last button (?tour=1). Each points at the
 * real control. Esc or Skip ends it, and it does not come back.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';

const STOPS = (n: number) => [
  { sel: '[data-tab="steps"]', title: 'This is the pipeline', body: 'Its steps come from a YAML file on disk. Edit them here or in the file; the next run uses what is saved.' },
  { sel: '[data-tour="run"]', title: 'Run it when you’re ready', body: `The ${n ? `${n} step${n === 1 ? '' : 's'}` : 'steps'} run in order as shell commands on this host. The log streams in live, and you can stop it at any step.` },
  { sel: '[data-tab="environment"]', title: 'Secrets go here', body: 'Variables for this pipeline, its group, or every pipeline. A secret stays hidden until someone who may change it reveals it.' },
  { sel: '[data-tab="auto-deploy"]', title: 'Deploy on every push', body: 'Watch a branch and this pipeline runs when it moves, with the commit on the run from the start.' },
];

type Box = { top: number; left: number; width: number; height: number };

export function Tour({ steps }: { steps: number }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tour') === '1';
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const stops = STOPS(steps);
  const stop = stops[i];

  const end = useCallback(() => {
    void api('/me/state/tour.done', { method: 'PUT', body: { value: true } }).catch(() => {});
    const next = new URLSearchParams(params);
    next.delete('tour');
    setParams(next, { replace: true });
  }, [params, setParams]);

  useLayoutEffect(() => {
    if (!asked) return;
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(stop.sel);
      if (!el) { setBox(null); return; }
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const tick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    document.querySelector(stop.sel)?.scrollIntoView({ block: 'nearest' });
    tick();
    const t = window.setTimeout(tick, 250);
    window.addEventListener('resize', tick);
    window.addEventListener('scroll', tick, true);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); window.removeEventListener('resize', tick); window.removeEventListener('scroll', tick, true); };
  }, [asked, stop.sel]);

  useEffect(() => {
    if (!asked) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') end(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [asked, end]);

  if (!asked) return null;
  const pad = 4;
  const W = Math.min(340, window.innerWidth - 24);
  const pop = box
    ? { top: box.top + box.height + 14, left: Math.max(12, Math.min(box.left + box.width / 2 - W / 2, window.innerWidth - W - 12)) }
    : { top: window.innerHeight / 2 - 100, left: window.innerWidth / 2 - W / 2 };
  const arrow = box ? Math.max(16, Math.min(box.left + box.width / 2 - pop.left, W - 16)) : null;
  const last = i === stops.length - 1;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {box ? (
        <div aria-hidden className="pointer-events-none absolute rounded-box shadow-[0_0_0_9999px_rgba(0,0,0,.55),0_0_0_2px_var(--primary)] transition-all duration-200"
          style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />
      ) : <div aria-hidden className="absolute inset-0 bg-black/55" />}
      <div className="absolute rounded-card border border-line-2 bg-surface p-5 shadow-e2" style={{ top: pop.top, left: pop.left, width: W }}>
        {arrow != null && <span aria-hidden className="absolute -top-[7px] size-3 rotate-45 border-l border-t border-line-2 bg-surface" style={{ left: arrow - 6 }} />}
        <div className="flex items-start">
          <span className="flex-1 font-mono text-[11px] uppercase tracking-[0.12em] text-primary-hi">Tour · {i + 1} of {stops.length}</span>
          <button type="button" aria-label="End the tour" onClick={end} className="-m-1 grid size-6 place-items-center text-fg-3 hover:text-fg"><X className="size-4" /></button>
        </div>
        <h2 id="tour-title" className="mt-2 text-[16px] font-semibold">{stop.title}</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">{stop.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <span className="flex flex-1 gap-1">{stops.map((_, k) => <span key={k} className={cx('h-1.5 rounded-full transition-all', k === i ? 'w-4 bg-primary' : 'w-1.5 bg-line-3')} />)}</span>
          {!last && <Button size="sm" variant="ghost" onClick={end}>Skip tour</Button>}
          <Button size="sm" autoFocus iconRight={last ? undefined : <ArrowRight className="size-3.5" />} onClick={() => (last ? end() : setI(i + 1))}>{last ? 'Done' : 'Next'}</Button>
        </div>
      </div>
    </div>
  );
}
