import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type Tone = 'neutral' | 'ok' | 'run' | 'warn' | 'fail' | 'auto';

const TONE: Record<Tone, string> = {
  neutral: 'text-fg-2 bg-surface-2 border-line-2',
  ok: 'text-primary-hi bg-primary-soft border-primary-line',
  run: 'text-run bg-run-soft border-run-line',
  warn: 'text-warn bg-warn-soft border-warn-line',
  fail: 'text-fail bg-fail-soft border-fail-line',
  auto: 'text-auto bg-auto-soft border-auto-line',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
  /** Pulsing dot, for something happening right now. */
  live?: boolean;
  /** Environment tag style: mono, uppercase, square corners. */
  env?: boolean;
  icon?: ReactNode;
}

export function Badge({ tone = 'neutral', dot, live, env, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex h-[22px] shrink-0 items-center gap-[5px] whitespace-nowrap border px-2 text-[11.5px] font-medium leading-none',
        env ? 'rounded-[4px] font-mono text-[10.5px] uppercase tracking-[0.06em]' : 'rounded-full',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {(dot || live) && <Dot live={live} />}
      {icon}
      {children}
    </span>
  );
}

export function Dot({ live, className }: { live?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block size-2 shrink-0 rounded-full bg-current',
        live && 'shadow-[0_0_0_4px_color-mix(in_srgb,currentColor_22%,transparent)] motion-safe:animate-pulse',
        className,
      )}
    />
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-b-2 border-line-3 bg-surface-2 px-[5px]',
        'font-mono text-[11px] font-medium text-fg-2',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
