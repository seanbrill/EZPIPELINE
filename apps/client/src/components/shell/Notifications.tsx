/**
 * The notification centre (design sheet f70): what happened to runs this
 * person can see, from the same history the rest of the app reads. Approvals
 * waiting stay at the top and never count as read until someone acts.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Bell, CheckCircle2, CircleStop, ShieldAlert, XCircle } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useLive } from '../../contexts/LiveContext';
import type { Notice } from '../../contexts/LiveContext';
import { useIsPhone } from '../../hooks/useMediaQuery';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';

const KIND = {
  approval: { icon: <ShieldAlert />, cls: 'text-warn', text: 'is waiting for approval' },
  failed: { icon: <XCircle />, cls: 'text-fail', text: 'failed' },
  succeeded: { icon: <CheckCircle2 />, cls: 'text-primary-hi', text: 'succeeded' },
  aborted: { icon: <CircleStop />, cls: 'text-fg-3', text: 'was cancelled' },
} as const;

function NoticeList({ onPick }: { onPick: () => void }) {
  const { notices, seenAt } = useLive();
  const ordered = [...notices.filter((n) => n.kind === 'approval'), ...notices.filter((n) => n.kind !== 'approval')];
  if (!ordered.length) return <p className="px-4 py-10 text-center text-[13.5px] text-fg-3">Nothing in the last 7 days. Failures, approvals and finished runs show up here.</p>;
  return (
    <ul className="flex flex-col">
      {ordered.map((n: Notice) => {
        const k = KIND[n.kind];
        const unread = n.kind === 'approval' || !seenAt || Date.parse(n.at) > Date.parse(seenAt);
        const c = n.run.commits?.[0];
        return (
          <li key={n.id}>
            <Link to={`/runs/${n.run.id}`} onClick={onPick} className="flex gap-3 rounded-box px-3 py-2.5 hover:bg-surface-3">
              <span className={cx('mt-0.5 [&>svg]:size-[18px]', k.cls)}>{k.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] text-fg">
                  <b className="font-semibold">{n.run.pipelineName} #{n.run.buildNumber}</b> {k.text}
                </span>
                {c && <span className="block truncate text-[12.5px] text-fg-3"><span className="font-mono">{c.shortSha}</span> {c.subject}</span>}
                <span className="block text-[12px] text-fg-3">{formatDistanceToNowStrict(new Date(n.at), { addSuffix: true })}</span>
              </span>
              {unread && <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.kind === 'approval' ? 'bg-warn' : 'bg-primary')} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function NotificationBell() {
  const { unread, markAllRead } = useLive();
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || phone) return;
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, phone]);

  return (
    <>
      <button ref={btn} type="button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => { setRect(btn.current?.getBoundingClientRect() ?? null); setOpen((o) => !o); }}
        className="relative grid size-9 place-items-center rounded-ctl text-fg-2 hover:bg-surface-3 hover:text-fg">
        <Bell className="size-[18px]" />
        {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-warn px-1 text-[10px] font-bold leading-4 text-bg">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {phone ? (
        <Modal open={open} onClose={() => setOpen(false)} title="Notifications" size="sm"
          footer={<Button variant="ghost" onClick={() => { markAllRead(); setOpen(false); }}>Mark all read</Button>}>
          <div className="-mx-3"><NoticeList onPick={() => setOpen(false)} /></div>
        </Modal>
      ) : open && rect && createPortal(
        <div ref={panel} role="dialog" aria-label="Notifications" style={{ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) }}
          className="menu-enter fixed z-[150] flex max-h-[70vh] w-[380px] flex-col rounded-card border border-line-2 bg-surface-2 shadow-e2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-[14px] font-semibold">Notifications</span>
            <button type="button" className="text-[12.5px] text-fg-2 hover:text-fg" onClick={markAllRead}>Mark all read</button>
          </div>
          <div className="min-h-0 overflow-y-auto p-1.5"><NoticeList onPick={() => setOpen(false)} /></div>
        </div>,
        document.body,
      )}
    </>
  );
}
