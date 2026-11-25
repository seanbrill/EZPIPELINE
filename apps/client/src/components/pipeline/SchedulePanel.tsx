/**
 * A pipeline's schedules (design sheet f142). Each in words first, cron and
 * time zone under it, the next three times, and how its last run went.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, isToday, isTomorrow } from 'date-fns';
import { CalendarClock, CircleCheck, CircleX, MoreHorizontal, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { describeCron, nextTimes } from '../../lib/cron';
import { useLive } from '../../contexts/LiveContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { Button, IconButton } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Switch } from '../ui/Toggle';
import { Segmented } from '../ui/Tabs';
import { Menu } from '../ui/Menu';
import { Badge } from '../ui/Badge';
import { Card, EmptyState, ErrorState, Skeleton } from '../ui/Feedback';
import { cx } from '../ui/cx';

interface Schedule { id: number; cron_expression: string; enabled: number; last_run: string | null; next_run: string | null }
type Preset = 'hourly' | 'daily' | 'weekly' | 'custom';

const when = (d: Date) => `${isToday(d) ? 'Today' : isTomorrow(d) ? 'Tomorrow' : format(d, 'EEE d MMM')} ${format(d, 'HH:mm')}`;
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function build(p: Preset, time: string, minute: string, day: string, raw: string) {
  const [h, m] = (time || '03:00').split(':').map((x) => Number(x) || 0);
  if (p === 'hourly') return `${Math.min(59, Number(minute) || 0)} * * * *`;
  if (p === 'daily') return `${m} ${h} * * *`;
  if (p === 'weekly') return `${m} ${h} * * ${day}`;
  return raw.trim();
}

export function SchedulePanel({ pipelineId, canEdit }: { pipelineId: string; canEdit: boolean }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const { history } = useLive();
  const [list, setList] = useState<Schedule[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState<Preset>('daily');
  const [time, setTime] = useState('03:00');
  const [minute, setMinute] = useState('0');
  const [day, setDay] = useState('1');
  const [raw, setRaw] = useState('0 3 * * *');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ schedules: Schedule[] }>(`/schedules/${encodeURIComponent(pipelineId)}`).then((r) => { setList(r.schedules); setErr(null); }).catch((e) => setErr((e as Error).message));
  }, [pipelineId]);
  useEffect(load, [load]);

  const lastScheduled = useMemo(() => history.find((h) => h.pipelineId === pipelineId && /schedule/i.test(h.triggeredBy ?? '')), [history, pipelineId]);
  const expr = build(preset, time, minute, day, raw);
  const next = nextTimes(expr, 3);
  const words = describeCron(expr);

  const add = async () => {
    setBusy(true);
    try {
      await api('/schedules', { body: { pipelineTarget: pipelineId, cronExpression: expr } });
      toast.success('Schedule added', { description: words ?? expr });
      setAdding(false);
      load();
    } catch (e) { toast.error('Could not add it', { description: (e as Error).message }); }
    setBusy(false);
  };
  const toggle = async (s: Schedule) => {
    try { await api(`/schedules/${s.id}/toggle`, { method: 'PATCH', body: { enabled: !s.enabled } }); load(); }
    catch (e) { toast.error('Could not change it', { description: (e as Error).message }); }
  };
  const remove = async (s: Schedule) => {
    if (!(await confirm({ title: 'Delete this schedule?', message: `${describeCron(s.cron_expression) ?? s.cron_expression}. Runs it already started are kept.`, confirmText: 'Delete', isDangerous: true }))) return;
    try { await api(`/schedules/${s.id}`, { method: 'DELETE' }); load(); }
    catch (e) { toast.error('Could not delete it', { description: (e as Error).message }); }
  };

  if (err) return <ErrorState title="Could not load the schedules" detail={err} action={<Button onClick={load}>Try again</Button>} />;
  if (!list) return <Skeleton className="h-40 w-full" rounded="rounded-card" />;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-3">
        {list.length === 0 && !adding && (
          <Card pad={false}><EmptyState icon={<CalendarClock />} title="No schedule"
            action={canEdit ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add a schedule</Button> : undefined}>
            This pipeline runs when someone presses Run, or when a watched branch moves.
          </EmptyState></Card>
        )}
        {list.map((s) => {
          const on = !!s.enabled;
          const times = on ? nextTimes(s.cron_expression, 3) : [];
          return (
            <Card key={s.id} pad={false} className={cx(!on && 'opacity-75')}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                {canEdit ? <Switch checked={on} onChange={() => void toggle(s)} label={<span className="sr-only">Enabled</span>} /> : null}
                <div className="min-w-0 flex-1">
                  <b className="text-[14px] font-semibold">{describeCron(s.cron_expression) ?? 'Custom schedule'}</b>
                  <div className="font-mono text-[12px] text-fg-3">{s.cron_expression} · {zone} (server time)</div>
                </div>
                {!on ? <Badge>paused</Badge> : lastScheduled ? (
                  lastScheduled.status === 'success' ? <Badge tone="ok"><CircleCheck className="size-3.5" />last run passed</Badge>
                    : lastScheduled.status === 'failed' ? <Badge tone="fail"><CircleX className="size-3.5" />last run failed</Badge> : null
                ) : null}
                {canEdit && (
                  <Menu title="Schedule" trigger={<IconButton size="sm" label="Schedule options"><MoreHorizontal className="size-4" /></IconButton>}
                    items={[{ label: on ? 'Pause' : 'Resume', onSelect: () => void toggle(s) }, { label: 'Delete', danger: true, onSelect: () => void remove(s) }]} />
                )}
              </div>
              {on && times.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-b-card border-t border-line bg-bg-2 px-4 py-2.5 text-[12.5px]">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">Next</span>
                  {times.map((t, i) => <span key={i} className={i ? 'text-fg-3' : ''}>{when(t)}</span>)}
                  {s.last_run && <span className="ml-auto text-fg-3">last started {format(new Date(s.last_run), 'd MMM HH:mm')}</span>}
                </div>
              )}
            </Card>
          );
        })}
        {canEdit && list.length > 0 && !adding && <div><Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add a schedule</Button></div>}
        {adding && (
          <Card className="flex flex-col gap-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">New schedule</div>
            <Segmented value={preset} onChange={setPreset} items={[{ id: 'hourly', label: 'Hourly' }, { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }, { id: 'custom', label: 'Custom cron' }]} />
            <div className="flex flex-wrap gap-3">
              {preset === 'hourly' && <Field label="Minute past the hour" className="w-44"><Input mono type="number" min={0} max={59} value={minute} onChange={(e) => setMinute(e.target.value)} /></Field>}
              {(preset === 'daily' || preset === 'weekly') && <Field label="At" className="w-36"><Input mono type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>}
              {preset === 'weekly' && (
                <Field label="On" className="w-44">
                  <select className="h-9 rounded-ctl border border-line-2 bg-bg-2 px-2 text-[13.5px]" value={day} onChange={(e) => setDay(e.target.value)}>
                    {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={String(i)}>{d}</option>)}
                    <option value="1-5">Weekdays</option>
                  </select>
                </Field>
              )}
              {preset === 'custom' && <Field label="Cron (minute hour day month weekday)" className="min-w-[260px] flex-1" error={next.length ? undefined : 'Not a cron expression this can run.'}><Input mono value={raw} onChange={(e) => setRaw(e.target.value)} /></Field>}
            </div>
            <p className="text-[13px]">
              {next.length ? <>Runs <b>{(words ?? expr).replace(/^./, (c) => c.toLowerCase())}</b>. Next: {next.map(when).join(', ')}.</> : <span className="text-fail">This never runs.</span>}
              <span className="text-fg-3"> Server time ({zone}).</span>
            </p>
            <p className="text-[12.5px] text-fg-3">A gate in the pipeline still waits for someone. A schedule cannot approve.</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!next.length} onClick={() => void add()}>Add schedule</Button>
            </div>
          </Card>
        )}
      </div>
      <Card>
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">How a scheduled run starts</div>
        <p className="mt-2.5 text-[13px] leading-relaxed">With the files as they are on disk when it starts, the same as pressing Run. The run&rsquo;s trigger reads <Badge>schedule</Badge>.</p>
      </Card>
    </div>
  );
}
