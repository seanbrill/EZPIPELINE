/**
 * Getting started, on the Overview (design sheet f16). Each item is read from
 * what is really there, so it un-ticks if the thing goes away. The first open
 * item is expanded with the one action that does it. Hidden per person.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Play } from 'lucide-react';
import { api } from '../../lib/api';
import { useLive } from '../../contexts/LiveContext';
import { useRunActions } from '../run/useRunActions';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Feedback';
import { cx } from '../ui/cx';

interface Item { id: string; done: boolean; detail?: string }

const TEXT: Record<string, { title: string; where: string; to: string }> = {
  admin: { title: 'Create the admin account', where: 'Setup', to: '/settings/account' },
  git: { title: 'Connect git', where: 'A group › Credentials', to: '/pipelines' },
  plugins: { title: 'Install plugins', where: 'Settings › Plugins', to: '/settings/plugins' },
  pipeline: { title: 'Make your first pipeline', where: 'Pipelines › New pipeline', to: '/pipelines' },
  run: { title: 'Run a pipeline', where: 'Run', to: '/pipelines' },
  watch: { title: 'Deploy on every push', where: 'Auto deploy', to: '/pipelines' },
  teammate: { title: 'Invite a teammate', where: 'Admin › Users & roles', to: '/admin/users' },
};

export function GettingStarted() {
  const nav = useNavigate();
  const { pipelines, history } = useLive();
  const { run } = useRunActions();
  const [items, setItems] = useState<Item[] | null>(null);
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ items: Item[] }>('/onboarding'),
      api<{ state: Record<string, unknown> }>('/me/state').catch(() => ({ state: {} as Record<string, unknown> })),
    ]).then(([o, s]) => { if (live) { setItems(o.items); setHidden(s.state['checklist.hidden'] === true); } }).catch(() => {});
    return () => { live = false; };
  }, [pipelines.length, history.length]);

  if (!items || hidden !== false) return null;
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  const nextId = items.find((i) => !i.done)?.id;
  const first = pipelines[0];

  const hide = () => { setHidden(true); void api('/me/state/checklist.hidden', { method: 'PUT', body: { value: true } }).catch(() => {}); };
  const title = (i: Item) => (i.id === 'run' && first ? `Run ${first.appName}` : i.id === 'watch' ? 'Deploy on every push' : TEXT[i.id]?.title ?? i.id);

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex items-start gap-3 px-5 pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold">Getting started</h2>
          <p className="mt-0.5 text-[13px] text-fg-3">{done} of {items.length} done.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={hide}>Hide checklist</Button>
      </div>
      <div className="flex gap-1 px-5 pb-4">{items.map((i) => <span key={i.id} className={cx('h-1 flex-1 rounded-full', i.done ? 'bg-primary' : 'bg-line-2')} />)}</div>
      <ul>
        {items.map((i) => {
          const open = i.id === nextId;
          const t = TEXT[i.id];
          return (
            <li key={i.id} className={cx('border-t border-line', open && 'border-l-2 border-l-primary bg-surface-2')}>
              <div className="flex items-center gap-3 px-5 py-3">
                <span className={cx('grid size-[18px] shrink-0 place-items-center rounded-full border', i.done ? 'border-primary bg-primary text-primary-ink' : open ? 'border-primary' : 'border-line-3')}>{i.done && <Check className="size-3" strokeWidth={3} />}</span>
                <span className={cx('min-w-0 flex-1 truncate text-[14px]', i.done ? 'text-fg-3 line-through' : open ? 'font-semibold' : '')}>{title(i)}</span>
                {open && <Badge>Next</Badge>}
                <span className="hidden shrink-0 text-[12.5px] text-fg-3 sm:inline">{i.detail ?? t?.where}</span>
              </div>
              {open && (
                <div className="flex flex-wrap items-center gap-3 px-5 pb-4 pl-[50px]">
                  {i.id === 'run' && first ? (
                    <>
                      <Button variant="primary" icon={<Play className="size-4" />} onClick={() => void run(first, { open: true })}>Run it now</Button>
                      <Link className="text-[13.5px] font-medium text-fg-2 hover:text-fg" to={`/pipelines/${encodeURIComponent(first.id)}/steps`}>Open the YAML first</Link>
                    </>
                  ) : i.id === 'watch' && first ? (
                    <Button variant="primary" onClick={() => nav(`/pipelines/${encodeURIComponent(first.id)}/auto-deploy`)}>Watch a branch</Button>
                  ) : i.id === 'git' && first?.group ? (
                    <Button variant="primary" onClick={() => nav(`/groups/${first.group!.split('/').map(encodeURIComponent).join('/')}/credentials`)}>Add a deploy key</Button>
                  ) : (
                    <Button variant="primary" onClick={() => nav(t?.to ?? '/')}>{i.id === 'pipeline' ? 'New pipeline' : 'Open'}</Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
