/**
 * A small label that appears on hover or keyboard focus after a short delay.
 *
 * CSS only (group-hover / group-focus-within), so it costs nothing until it is
 * shown and needs no positioning code. The trade-off: inside an element with
 * `overflow: hidden` it can be clipped, so give such places `side="bottom"` or
 * put the hint in the visible label instead.
 */
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Kbd } from './Badge';

interface TooltipProps {
  content: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom';
  children: ReactNode;
  className?: string;
}

export function Tooltip({ content, shortcut, side = 'top', children, className }: TooltipProps) {
  return (
    <span className={cx('group/tt relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-ctl px-2 py-1',
          'bg-fg text-bg text-[12px] font-medium shadow-e2 flex items-center gap-1.5',
          'opacity-0 transition-opacity duration-[var(--dur-fast)]',
          'group-hover/tt:opacity-100 group-hover/tt:delay-500 group-focus-within/tt:opacity-100',
          side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
        )}
      >
        {content}
        {shortcut && <Kbd className="!h-4 !min-w-4 !bg-transparent !text-bg/70 !border-bg/30">{shortcut}</Kbd>}
      </span>
    </span>
  );
}
