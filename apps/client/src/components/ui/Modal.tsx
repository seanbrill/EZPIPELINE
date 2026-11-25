/**
 * The modal (design sheet f5): "a modal asks one question".
 *
 * - Three widths: S 440 (confirm, delete, discard), M 600 (a few fields, keys,
 *   approvals), L 840 (pickers and previews in two columns).
 * - Focus lands on [data-autofocus], else the first field, else Cancel; Tab is
 *   held inside; on close it returns to whatever opened the dialog.
 * - Esc always means Cancel. A click on the scrim closes only when nothing has
 *   been typed (`dirty`), so a half-filled form is never lost to a stray click.
 * - While `busy`, nothing dismisses it and the close button is hidden.
 * - ⌘↵ / Ctrl↵ calls onSubmit from anywhere inside.
 * - Below 640px it is a bottom sheet with a grabber you can drag down to close.
 * - Motion: in, the scrim fades and the dialog scales .96→1 over 200ms; out is
 *   a 120ms fade. Reduced motion: fades only (the tokens go to 0ms).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as RPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './Button';
import { useIsPhone } from '../../hooks/useMediaQuery';

export type ModalSize = 'sm' | 'md' | 'lg';
const WIDTH: Record<ModalSize, string> = { sm: 'sm:max-w-[440px]', md: 'sm:max-w-[600px]', lg: 'sm:max-w-[840px]' };

export type IconTone = 'neutral' | 'ok' | 'run' | 'warn' | 'fail';
const ICON_TONE: Record<IconTone, string> = {
  neutral: 'bg-surface-3 border-line-2 text-fg-2',
  ok: 'bg-primary-soft border-primary-line text-primary-hi',
  run: 'bg-run-soft border-run-line text-run',
  warn: 'bg-warn-soft border-warn-line text-warn',
  fail: 'bg-fail-soft border-fail-line text-fail',
};

export function IconTile({ tone = 'neutral', children, className }: { tone?: IconTone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('grid size-9 shrink-0 place-items-center rounded-box border [&>svg]:size-[18px]', ICON_TONE[tone], className)}>
      {children}
    </span>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  iconTone?: IconTone;
  size?: ModalSize;
  children?: ReactNode;
  /** Buttons, right-aligned: Cancel first, then the one primary. */
  footer?: ReactNode;
  /** Keyboard hints or a note, on the left of the footer. */
  footerStart?: ReactNode;
  /** Something has been typed: the scrim no longer closes it. */
  dirty?: boolean;
  /** A request is in flight: nothing closes it. */
  busy?: boolean;
  /** ⌘↵ calls this. */
  onSubmit?: () => void;
  /** An error, in words, above the footer. It takes focus when it appears. */
  error?: ReactNode;
  className?: string;
}

// Open modals, innermost last: only the top one answers Esc and holds focus.
const stack: string[] = [];

export function Modal({
  open, onClose, title, description, icon, iconTone = 'neutral', size = 'md', children,
  footer, footerStart, dirty, busy, onSubmit, error, className,
}: ModalProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const phone = useIsPhone();
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);

  // Mount, then show on the next frame so the enter transition runs; on close,
  // hide first and unmount when the exit transition is done.
  useLayoutEffect(() => {
    if (open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      // Mount-then-show drives the enter transition; it has to be a second render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-fast')) || 0;
    const t = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(t);
  }, [open]);

  // Stack membership, scroll lock and focus restore follow `mounted`.
  useEffect(() => {
    if (!mounted) return;
    stack.push(id);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      stack.splice(stack.indexOf(id), 1);
      if (stack.length === 0) document.body.style.overflow = prevOverflow;
      returnTo.current?.focus?.();
    };
  }, [mounted, id]);

  // Initial focus.
  useEffect(() => {
    if (!shown || !dialog.current) return;
    const root = dialog.current;
    const target =
      root.querySelector<HTMLElement>('[data-autofocus]') ??
      root.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])') ??
      root.querySelector<HTMLElement>('[data-cancel]') ??
      root;
    target.focus();
  }, [shown]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const dismiss = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (stack[stack.length - 1] !== id) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      dismiss();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit && !busy) {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'Tab' && dialog.current) {
      const f = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  };

  // Phone: drag the grabber down; past 100px it closes, otherwise it springs back.
  const onGrabStart = (e: RPointerEvent) => {
    if (busy) return;
    dragStart.current = e.clientY;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onGrabMove = (e: RPointerEvent) => {
    if (dragStart.current !== null) setDrag(Math.max(0, e.clientY - dragStart.current));
  };
  const onGrabEnd = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (drag > 100) dismiss();
    setDrag(0);
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6" onKeyDown={onKeyDown}>
      <div
        aria-hidden="true"
        className={cx('absolute inset-0 bg-scrim backdrop-blur-[3px] transition-opacity', shown ? 'opacity-100 duration-[var(--dur-base)]' : 'opacity-0 duration-[var(--dur-fast)]')}
        onClick={() => !dirty && dismiss()}
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={description ? `${id}-d` : undefined}
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        className={cx(
          'relative flex w-full flex-col overflow-hidden border border-line-2 bg-surface shadow-e3 outline-none',
          'max-h-[calc(100dvh-24px)] rounded-t-modal sm:max-h-[calc(100dvh-160px)] sm:rounded-modal',
          WIDTH[size],
          'transition-[opacity,transform] ease-[var(--ease-out)]',
          shown
            ? 'opacity-100 translate-y-0 sm:scale-100 duration-[var(--dur-base)]'
            : 'opacity-0 translate-y-6 sm:translate-y-0 sm:scale-[.96] duration-[var(--dur-fast)]',
          phone && 'text-[16px]',
          className,
        )}
      >
        {phone && (
          <div
            className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
            onPointerDown={onGrabStart}
            onPointerMove={onGrabMove}
            onPointerUp={onGrabEnd}
            onPointerCancel={onGrabEnd}
          >
            <span className="h-1 w-9 rounded-full bg-line-3" />
          </div>
        )}
        <header className="flex shrink-0 items-start gap-3 px-6 pt-5 max-sm:pt-1">
          {icon && <IconTile tone={iconTone}>{icon}</IconTile>}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={`${id}-t`} className="text-[18px] font-semibold leading-tight tracking-[-0.02em] text-fg">{title}</h2>
            {description && <p id={`${id}-d`} className="mt-1 text-[13.5px] leading-snug text-fg-2">{description}</p>}
          </div>
          {!busy && (
            <IconButton label="Close" size="sm" tooltip={false} onClick={dismiss} className="-mr-2 -mt-0.5">
              <X className="size-4" />
            </IconButton>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {error && (
          <div ref={errorRef} tabIndex={-1} role="alert" className="mx-6 mb-4 rounded-box border border-fail-line bg-fail-soft px-3.5 py-2.5 text-[13px] text-fail outline-none">
            {error}
          </div>
        )}
        {footer && (
          <footer
            className={cx(
              'flex shrink-0 items-center gap-2 border-t border-line bg-bg-2 px-6 py-3.5',
              'max-sm:flex-col-reverse max-sm:items-stretch max-sm:pb-[max(14px,env(safe-area-inset-bottom))] max-sm:[&_button]:h-12 max-sm:[&_button]:text-[16px]',
            )}
          >
            {footerStart && <div className="mr-auto hidden items-center gap-1.5 text-[12px] text-fg-3 sm:flex">{footerStart}</div>}
            <div className={cx('flex gap-2 max-sm:flex-col-reverse', !footerStart && 'sm:ml-auto')}>{footer}</div>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
