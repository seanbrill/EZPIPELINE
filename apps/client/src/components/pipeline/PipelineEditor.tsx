/**
 * Steps & YAML (design sheet f81, guard f61).
 *
 * The step list and the YAML are two views of one document. Editing the YAML
 * re-reads the list; moving, adding or removing a step in the list rewrites
 * the YAML through the yaml Document API, so comments and formatting
 * elsewhere survive. Problems are checked against the server's own rules as
 * you type, and Save stays off until there are none. ⌘S saves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseDocument, isSeq, YAMLSeq } from 'yaml';
import { ArrowDown, ArrowUp, CircleX, TriangleAlert, GripVertical, Layers, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Tabs';
import { Badge, Kbd } from '../ui/Badge';
import { Card, ErrorState, Skeleton } from '../ui/Feedback';
import { cx } from '../ui/cx';
import { useIsPhone } from '../../hooks/useMediaQuery';

/** A warning is a field that does nothing: shown, and the file still saves. */
interface Problem { line: number | null; message: string; severity?: 'warning' }
interface StepView { name: string; run?: string; type?: string; shell?: string; cwd?: string; continueOnError?: boolean; children: number; line: number | null }

function readSteps(text: string): { steps: StepView[]; ok: boolean } {
  try {
    const doc = parseDocument(text.split('\n---')[0]);
    if (doc.errors.length) return { steps: [], ok: false };
    const seq = doc.get('steps', true);
    if (!isSeq(seq)) return { steps: [], ok: true };
    const lineAt = (o?: number) => (o == null ? null : text.slice(0, o).split('\n').length);
    return {
      ok: true,
      steps: seq.items.map((node) => {
        const s = (node as { toJSON: () => Record<string, unknown> }).toJSON?.() ?? {};
        return {
          name: String(s.name ?? '(no name)'), run: typeof s.run === 'string' ? s.run : undefined, type: s.type as string | undefined,
          shell: s.shell as string | undefined, cwd: s.cwd as string | undefined, continueOnError: !!s.continueOnError,
          children: Array.isArray(s.steps) ? s.steps.length : 0, line: lineAt((node as { range?: number[] }).range?.[0]),
        };
      }),
    };
  } catch { return { steps: [], ok: false }; }
}

function editSteps(text: string, fn: (seq: YAMLSeq, doc: ReturnType<typeof parseDocument>) => void): string | null {
  const [first, ...rest] = text.split('\n---');
  const doc = parseDocument(first);
  if (doc.errors.length) return null;
  let seq = doc.get('steps', true);
  if (!isSeq(seq)) { doc.set('steps', doc.createNode([])); seq = doc.get('steps', true); }
  fn(seq as YAMLSeq, doc);
  return [doc.toString().replace(/\n$/, ''), ...rest].join('\n---') + (text.endsWith('\n') ? '\n' : '');
}

export function PipelineEditor({ filePath, canEdit, onSaved, onDirty }: { filePath: string; canEdit: boolean; onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const toast = useToast();
  const phone = useIsPhone();
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const errors = problems.filter((p) => p.severity !== 'warning');
  const warnings = problems.length - errors.length;
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'both' | 'steps' | 'yaml'>('both');
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<{ content: string }>('/config/content', { body: { type: 'yaml', path: filePath } })
      .then((r) => { setSaved(r.content); setText(r.content); setErr(null); })
      .catch((e) => setErr((e as Error).message));
  }, [filePath]);
  useEffect(load, [load]);

  const dirty = saved !== null && text !== saved;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  // The server's own check, a moment after typing stops.
  useEffect(() => {
    if (saved === null) return;
    const t = window.setTimeout(() => {
      setChecking(true);
      api<{ problems: Problem[] }>('/config/validate', { body: { content: text } })
        .then((r) => setProblems(r.problems)).catch(() => {}).finally(() => setChecking(false));
    }, 350);
    return () => clearTimeout(t);
  }, [text, saved]);

  const save = useCallback(async () => {
    if (!dirty || errors.length || busy || !canEdit) return;
    setBusy(true);
    try {
      await api('/config/save', { body: { type: 'yaml', path: filePath, content: text } });
      setSaved(text);
      toast.success('Pipeline saved', { description: 'Changes apply from the next run.' });
      onSaved();
    } catch (e) { toast.error('Could not save', { description: (e as Error).message }); }
    setBusy(false);
  }, [dirty, errors.length, busy, canEdit, filePath, text, toast, onSaved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const { steps, ok } = useMemo(() => readSteps(text), [text]);
  const lines = text.split('\n').length;
  const bad = new Set(errors.map((p) => p.line).filter(Boolean) as number[]);
  const odd = new Set(problems.filter((p) => p.severity === 'warning').map((p) => p.line).filter(Boolean) as number[]);
  const changed = useMemo(() => {
    if (saved === null) return 0;
    const a = saved.split('\n'), b = text.split('\n');
    let n = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n++;
    return n;
  }, [saved, text]);

  const goTo = (line: number | null) => {
    const el = area.current;
    if (!el || line == null) return;
    if (view === 'steps') setView('both');
    const offset = text.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    el.focus();
    el.setSelectionRange(offset, offset);
    el.scrollTop = Math.max(0, (line - 4) * 20);
  };
  const apply = (fn: (seq: YAMLSeq, doc: ReturnType<typeof parseDocument>) => void) => {
    const next = editSteps(text, fn);
    if (next != null) setText(next);
  };
  const move = (i: number, d: -1 | 1) => apply((seq) => { const [n] = seq.items.splice(i, 1); seq.items.splice(i + d, 0, n); });

  if (err) return <ErrorState title="Could not open the pipeline file" detail={err} action={<Button onClick={load}>Try again</Button>} />;
  if (saved === null) return <Skeleton className="h-96 w-full" rounded="rounded-card" />;

  const showSteps = view !== 'yaml';
  const showYaml = view !== 'steps';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {!phone && <Segmented size="sm" value={view} onChange={setView} items={[{ id: 'both', label: 'Steps + YAML' }, { id: 'steps', label: 'Steps' }, { id: 'yaml', label: 'YAML' }]} />}
        <span className="text-[12.5px] text-fg-3">Changes apply from the next run.</span>
        <span className="flex-1" />
        {dirty && <span className="flex items-center gap-1.5 text-[12.5px] text-fg-2"><span className="size-1.5 rounded-full bg-warn" />{changed} unsaved line{changed === 1 ? '' : 's'}</span>}
        {dirty && <Button size="sm" variant="ghost" onClick={() => setText(saved)}>Discard</Button>}
        {canEdit && (
          <Button size="sm" variant="primary" loading={busy} loadingText="Saving…" disabled={!dirty || errors.length > 0} onClick={() => void save()}>
            Save {!phone && <Kbd className="ml-1 !border-primary-ink/25 !bg-primary-ink/10 !text-primary-ink">⌘S</Kbd>}
          </Button>
        )}
      </div>

      <div className={cx('grid items-start gap-4', showSteps && showYaml && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
        {showSteps && (
          <Card pad={false} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <b className="text-[14px] font-semibold">Steps</b>
              <span className="text-[12.5px] text-fg-3">{steps.length}{steps.some((s) => s.type === 'approval') ? ` · ${steps.filter((s) => s.type === 'approval').length} approval gate${steps.filter((s) => s.type === 'approval').length > 1 ? 's' : ''}` : ''}</span>
            </div>
            {!ok ? (
              <p className="px-4 py-6 text-[13px] text-fg-3">The YAML does not parse, so the steps cannot be shown. Fix the problem on the right.</p>
            ) : (
              <ol className="flex flex-col gap-2 p-3">
                {steps.map((s, i) => {
                  const gate = s.type === 'approval';
                  const broken = errors.some((p) => p.message.startsWith(`steps[${i}]`));
                  return (
                    <li key={i} className={cx('group/s flex gap-2.5 rounded-box border bg-surface-2 px-3 py-2.5', broken ? 'border-fail-line shadow-[inset_3px_0_0_var(--fail)]' : gate ? 'border-warn-line bg-warn-soft' : 'border-line')}>
                      <GripVertical className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden="true" />
                      <span className="mt-px w-5 shrink-0 font-mono text-[12px] text-fg-3">{i + 1}</span>
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => goTo(s.line)}>
                        <span className="flex items-center gap-1.5 text-[13.5px] font-medium">{s.name}{gate && <ShieldCheck className="size-3.5 text-warn" />}</span>
                        {gate ? <span className="mt-0.5 block text-[12.5px] text-fg-3">Pauses until someone who may run it approves</span>
                          : s.children ? <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-fg-3"><Layers className="size-3.5" />{s.children} substeps</span>
                            : <span className="mt-0.5 block truncate font-mono text-[12px] text-primary-hi">{s.run?.split('\n')[0]}{(s.run?.split('\n').filter(Boolean).length ?? 0) > 1 && <span className="text-fg-3"> +{s.run!.split('\n').filter(Boolean).length - 1} lines</span>}</span>}
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {gate ? <Badge tone="warn" className="font-mono">type approval</Badge> : <>
                            <Badge className="font-mono">shell {s.shell ?? 'default'}</Badge>
                            <Badge className="font-mono">in {s.cwd ?? 'workspace/'}</Badge>
                            <Badge className="font-mono">on failure {s.continueOnError ? 'continue' : 'stop'}</Badge>
                          </>}
                        </span>
                      </button>
                      {canEdit && (
                        <span className="flex shrink-0 flex-col opacity-0 transition-opacity group-focus-within/s:opacity-100 group-hover/s:opacity-100 max-sm:opacity-100">
                          <IconButton size="sm" label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></IconButton>
                          <IconButton size="sm" label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></IconButton>
                          <IconButton size="sm" label="Remove step" onClick={() => apply((seq) => { seq.items.splice(i, 1); })}><Trash2 className="size-3.5" /></IconButton>
                        </span>
                      )}
                    </li>
                  );
                })}
                {canEdit && (
                  <li className="mt-1 grid grid-cols-2 gap-2">
                    <Button variant="ghost" className="border border-dashed border-line-2" icon={<Plus className="size-4" />}
                      onClick={() => apply((seq, doc) => { seq.add(doc.createNode({ name: `Step ${seq.items.length + 1}`, run: 'echo "hello"' })); })}>Add a step</Button>
                    <Button variant="ghost" className="border border-dashed border-line-2" icon={<ShieldCheck className="size-4" />}
                      onClick={() => apply((seq, doc) => { seq.add(doc.createNode({ name: 'Approve', type: 'approval' })); })}>Add an approval gate</Button>
                  </li>
                )}
              </ol>
            )}
          </Card>
        )}

        {showYaml && (
          <Card pad={false} className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <b className="text-[14px] font-semibold">YAML</b>
              <span className="truncate font-mono text-[12px] text-fg-3">{filePath.split(/[\\/]pipelines[\\/]/).pop()}</span>
            </div>
            <div className="relative flex h-[min(70vh,720px)] min-h-[360px] bg-log-bg font-mono text-[13px] leading-5">
              <div ref={gutter} aria-hidden="true" className="w-12 shrink-0 select-none overflow-hidden py-3 pr-3 text-right text-fg-3">
                {Array.from({ length: lines }, (_, i) => (
                  <div key={i} className={cx(bad.has(i + 1) ? 'bg-fail-soft font-semibold text-fail' : odd.has(i + 1) && 'bg-warn-soft font-semibold text-warn')}>{i + 1}</div>
                ))}
              </div>
              <textarea ref={area} value={text} readOnly={!canEdit} spellCheck={false} aria-label="Pipeline YAML"
                onChange={(e) => setText(e.target.value)}
                onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
                onKeyDown={(e) => {
                  if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault();
                    const el = e.currentTarget, a = el.selectionStart, b = el.selectionEnd;
                    setText(text.slice(0, a) + '  ' + text.slice(b));
                    requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
                  }
                }}
                className="min-w-0 flex-1 resize-none whitespace-pre bg-transparent py-3 pr-4 text-log-fg outline-none" />
            </div>
            <div className="border-t border-line">
              <div className="flex items-center gap-2 px-4 py-2.5">
                <b className="text-[13px] font-semibold">Problems</b>
                {errors.length > 0 && <Badge tone="fail">{errors.length} error{errors.length > 1 ? 's' : ''}</Badge>}
                {warnings > 0 && <Badge tone="warn">{warnings} not used</Badge>}
                {!problems.length && <span className="text-[12.5px] text-primary-hi">{checking ? 'Checking…' : 'None'}</span>}
                <span className="ml-auto text-[12px] text-fg-3 max-sm:hidden">Checked as you type{errors.length ? ' · Save is off until it is fixed' : ''}</span>
              </div>
              {problems.length > 0 && (
                <ul className="max-h-40 overflow-y-auto border-t border-line">
                  {problems.map((p, i) => (
                    <li key={i} className="flex items-start gap-3 px-4 py-2 text-[13px]">
                      {p.severity === 'warning' ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-fail" />}
                      {p.line != null && <span className={cx('shrink-0 font-mono', p.severity === 'warning' ? 'text-warn' : 'text-fail')}>Line {p.line}</span>}
                      <span className="min-w-0 flex-1">{p.message}</span>
                      {p.line != null && <button type="button" className="shrink-0 text-[12.5px] text-primary-hi hover:underline" onClick={() => goTo(p.line)}>Go to line →</button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
