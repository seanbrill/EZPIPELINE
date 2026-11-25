/**
 * Whole-page states (design sheet f99–f102, f120): booting, not found, not
 * allowed, and a standard page frame.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Lock } from 'lucide-react';
import { LogoMark } from '../brand/Logo';
import { EmptyState } from '../ui/Feedback';
import { buttonClass } from '../ui/Button';
import { cx } from '../ui/cx';
import { usePageChrome } from './chrome';

export function BootSplash({ label = 'Starting…' }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <LogoMark size={56} state="running" />
        <span className="text-[13px] text-fg-3">{label}</span>
      </div>
    </div>
  );
}

/** The content column every page sits in. */
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cx('mx-auto w-full px-4 pb-16 pt-5 sm:px-8 sm:pt-8', wide ? 'max-w-[1400px]' : 'max-w-[1120px]', className)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-fg">{title}</h1>
        {description && <p className="mt-1 text-[14px] text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function NotFound() {
  usePageChrome([{ label: 'Not found' }]);
  return (
    <Page>
      <EmptyState icon={<Compass />} title="There is nothing at this address" action={<Link to="/" className={buttonClass('primary')}>Go to Overview</Link>}>
        The link may be old, or the pipeline or run it pointed to was deleted.
      </EmptyState>
    </Page>
  );
}

export function Forbidden({ what, need }: { what: string; need?: string }) {
  return (
    <EmptyState icon={<Lock />} title={`You can't ${what}`}>
      {need ? <>This needs <span className="font-mono text-fg">{need}</span>. Ask an admin to grant it.</> : 'Ask an admin for access.'}
    </EmptyState>
  );
}
