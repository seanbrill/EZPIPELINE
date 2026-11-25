/**
 * Banners, empty states, error states and skeletons (design sheet f69, f99–f102).
 *
 * An empty state says what will be here and offers the one action that fills
 * it. An error says what went wrong in words and what to do; it never shows a
 * stack trace or a status code on its own.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cx } from './cx';

type BannerTone = 'info' | 'ok' | 'warn' | 'fail';
const BANNER: Record<BannerTone, { cls: string; icon: ReactNode }> = {
  info: { cls: 'border-line-2 bg-surface-2 text-fg-2 [&_svg]:text-fg-2', icon: <Info /> },
  ok: { cls: 'border-primary-line bg-primary-soft text-fg [&_svg]:text-primary-hi', icon: <CheckCircle2 /> },
  warn: { cls: 'border-warn-line bg-warn-soft text-fg [&_svg]:text-warn', icon: <AlertTriangle /> },
  fail: { cls: 'border-fail-line bg-fail-soft text-fg [&_svg]:text-fail', icon: <XCircle /> },
};

export function Banner({ tone = 'info', title, children, action, className }: { tone?: BannerTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'fail' ? 'alert' : 'status'} className={cx('flex items-start gap-3 rounded-box border px-4 py-3 text-[13.5px]', BANNER[tone].cls, className)}>
      <span className="mt-0.5 shrink-0 [&>svg]:size-4">{BANNER[tone].icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-fg">{title}</p>}
        {children && <div className={cx('text-fg-2', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && <span className="mb-4 grid size-12 place-items-center rounded-card border border-line-2 bg-surface-2 text-fg-2 [&>svg]:size-[22px]">{icon}</span>}
      <h3 className="text-[16px] font-semibold text-fg">{title}</h3>
      {children && <p className="mt-1.5 max-w-[42ch] text-[13.5px] leading-relaxed text-fg-2 [text-wrap:pretty]">{children}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, children, action, detail, className }: { title: ReactNode; children?: ReactNode; action?: ReactNode; detail?: ReactNode; className?: string }) {
  return (
    <EmptyState className={className} icon={<XCircle className="text-fail" />} title={title} action={action}>
      {children}
      {detail && <span className="mt-3 block font-mono text-[12px] text-fg-3">{detail}</span>}
    </EmptyState>
  );
}

export function Skeleton({ className, rounded = 'rounded' }: { className?: string; rounded?: string }) {
  return <span aria-hidden="true" className={cx('skel block', rounded, className)} />;
}

export function Card({ className, children, pad = true }: { className?: string; children: ReactNode; pad?: boolean }) {
  return <div className={cx('rounded-card border border-line bg-surface shadow-e1', pad && 'p-5', className)}>{children}</div>;
}
