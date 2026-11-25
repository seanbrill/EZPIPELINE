/**
 * The toast stack. See ToastContext for the rules it draws.
 *
 * The countdown is the progress bar's own CSS animation: hovering the stack
 * sets --toast-play to paused, which pauses every bar, and a bar finishing
 * dismisses its toast. So "hover pauses all timers" holds without any timer
 * bookkeeping, and the bar can never disagree with when the toast leaves.
 */
import { useRef } from 'react';
import type { PointerEvent as RPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, Loader2, ShieldAlert, X, XCircle } from 'lucide-react';
import type { ToastItem, ToastTone } from '../../contexts/ToastContext';
import { cx } from '../ui/cx';
import { CommitChip } from '../run/CommitChip';
import { useIsPhone } from '../../hooks/useMediaQuery';

const TONE: Record<ToastTone, { icon: ReactNode; tile: string; bar: string; border: string }> = {
  success: { icon: <CheckCircle2 />, tile: 'text-primary-hi bg-primary-soft border-primary-line', bar: 'bg-primary', border: 'border-line-2' },
  error: { icon: <XCircle />, tile: 'text-fail bg-fail-soft border-fail-line', bar: 'bg-fail', border: 'border-fail-line' },
  warning: { icon: <ShieldAlert />, tile: 'text-warn bg-warn-soft border-warn-line', bar: 'bg-warn', border: 'border-warn-line' },
  info: { icon: <Info />, tile: 'text-fg-2 bg-surface-3 border-line-2', bar: 'bg-fg-3', border: 'border-line-2' },
  running: { icon: <Loader2 className="motion-safe:animate-spin" />, tile: 'text-run bg-run-soft border-run-line', bar: 'bg-run', border: 'border-line-2' },
};

function ToastCard({ t, onDismiss, phone }: { t: ToastItem; onDismiss: (id: string) => void; phone: boolean }) {
  const tone = TONE[t.tone];
  const startY = useRef<number | null>(null);
  const onDown = (e: RPointerEvent) => {
    if (phone) startY.current = e.clientY;
  };
  const onUp = (e: RPointerEvent) => {
    if (startY.current !== null && e.clientY - startY.current < -30) onDismiss(t.id);
    startY.current = null;
  };
  const leaving = Boolean(t.leavingAt);
  return (
    <div
      role={t.tone === 'error' ? 'alert' : 'status'}
      onPointerDown={onDown}
      onPointerUp={onUp}
      className={cx(
        'pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-card border bg-surface-2 px-4 py-3.5 shadow-e2',
        tone.border,
        'transition-[opacity,transform] duration-[var(--dur-fast)] ease-[var(--ease-in)]',
        leaving ? 'opacity-0 translate-x-4 max-sm:translate-x-0 max-sm:-translate-y-4' : 'toast-enter',
      )}
    >
      <span className={cx('grid size-8 shrink-0 place-items-center rounded-box border [&>svg]:size-4', tone.tile)}>{tone.icon}</span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[14px] font-semibold leading-snug text-fg">{t.title}</p>
        {t.commit && (
          <p className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px] text-fg-2">
            <CommitChip sha={t.commit.sha} branch={t.commit.branch} />
            {t.commit.subject && <span className="truncate">{t.commit.subject}</span>}
          </p>
        )}
        {t.description && <p className="mt-1 text-[13px] leading-snug text-fg-2">{t.description}</p>}
        {t.action && (
          <button
            type="button"
            onClick={() => {
              t.action!.onClick();
              onDismiss(t.id);
            }}
            className="mt-2 text-[13px] font-medium text-primary-hi hover:underline"
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(t.id)}
        className="-mr-1.5 -mt-1 grid size-7 shrink-0 place-items-center rounded-ctl text-fg-3 hover:bg-surface-3 hover:text-fg"
      >
        <X className="size-4" />
      </button>
      {!t.sticky && !leaving && (
        <span
          aria-hidden="true"
          onAnimationEnd={() => onDismiss(t.id)}
          className={cx('toast-timer absolute bottom-0 left-0 h-[2px] w-full origin-left opacity-70', tone.bar)}
          style={{ animationDuration: `${t.duration}ms` }}
        />
      )}
    </div>
  );
}

export function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  const phone = useIsPhone();
  if (toasts.length === 0) return null;
  const live = toasts.filter((t) => !t.leavingAt);
  const shown = phone ? live.slice(0, 1) : toasts;
  const more = phone ? live.length - 1 : 0;
  return createPortal(
    <section
      aria-label="Notifications"
      className={cx(
        'toast-stack pointer-events-none fixed z-[200] flex flex-col gap-2',
        phone ? 'inset-x-3 top-[max(12px,env(safe-area-inset-top))]' : 'bottom-[88px] right-6 w-[380px]',
      )}
    >
      {shown.map((t) => (
        <ToastCard key={t.id} t={t} onDismiss={onDismiss} phone={phone} />
      ))}
      {more > 0 && (
        <span className="pointer-events-none absolute right-12 top-3 rounded-full bg-surface-3 px-1.5 font-mono text-[11px] text-fg-2">+{more}</span>
      )}
    </section>,
    document.body,
  );
}

export default Toaster;
