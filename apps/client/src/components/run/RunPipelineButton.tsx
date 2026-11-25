/**
 * "Run pipeline…" (top bar on most pages, key R): pick a pipeline you may
 * run and start it. On a pipeline's own page the button runs that pipeline
 * directly instead.
 */
import { useEffect, useMemo, useState } from 'react';
import { Play, Search } from 'lucide-react';
import { useLive } from '../../contexts/LiveContext';
import { useIsPhone } from '../../hooks/useMediaQuery';
import { Button, IconButton } from '../ui/Button';
import { Kbd } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Field';
import { useRunActions } from './useRunActions';

export function RunPipelineButton() {
  const { pipelines } = useLive();
  const phone = useIsPhone();
  const { run } = useRunActions();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const runnable = useMemo(() => pipelines.filter((p) => p.permissions?.canRun !== false), [pipelines]);
  const shown = runnable.filter((p) => `${p.appName} ${p.group ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"], .monaco-editor, [role="dialog"]')) return;
      e.preventDefault();
      setQ('');
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!runnable.length) return null;
  return (
    <>
      {phone ? (
        <IconButton label="Run a pipeline" tooltip={false} onClick={() => { setQ(''); setOpen(true); }}><Play className="size-5" /></IconButton>
      ) : (
        <Button variant="primary" icon={<Play className="size-4" />} onClick={() => { setQ(''); setOpen(true); }}>
          Run pipeline… <Kbd className="ml-1 !border-primary-ink/25 !bg-primary-ink/10 !text-primary-ink">R</Kbd>
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Run a pipeline" size="sm" icon={<Play />}>
        <Input autoFocus leading={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pipeline or group" aria-label="Find a pipeline"
          onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { setOpen(false); void run(shown[0], { open: true }); } }} />
        <ul className="-mx-2 mt-3 max-h-[50vh] overflow-y-auto">
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { setOpen(false); void run(p, { open: true }); }}
                className="flex min-h-11 w-full items-center gap-3 rounded-box px-3 text-left hover:bg-surface-3">
                <Play className="size-4 text-primary-hi" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{p.appName}</span><span className="block truncate text-[12px] text-fg-3">{p.group}</span></span>
                {p.environment && <span className="font-mono text-[11px] uppercase text-fg-3">{p.environment}</span>}
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-3 py-6 text-center text-[13px] text-fg-3">No pipeline you can run matches “{q}”.</li>}
        </ul>
      </Modal>
    </>
  );
}
