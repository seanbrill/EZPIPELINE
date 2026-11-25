/**
 * Tabs and the segmented control (design sheet f42).
 *
 * Tabs switch between views of one thing and can be links, so a tab has a URL
 * and the back button works. Segmented narrows what one view shows (a filter);
 * it never changes the URL path.
 */
import { NavLink } from 'react-router-dom';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from './cx';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number | string;
  /** When given, the tab is a link to this path. */
  to?: string;
  hidden?: boolean;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value?: T;
  onChange?: (id: T) => void;
  className?: string;
  /** Accessible name of the tab list. */
  label?: string;
}

const TAB =
  'relative inline-flex h-10 shrink-0 items-center gap-[7px] px-3 text-[13.5px] font-medium text-fg-2 ' +
  'border-b-2 border-transparent -mb-px transition-colors duration-[var(--dur-fast)] hover:text-fg';
const TAB_ON = 'text-fg border-primary';

function Count({ n }: { n: number | string }) {
  return <span className="rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-3">{n}</span>;
}

export function Tabs<T extends string>({ items, value, onChange, className, label }: TabsProps<T>) {
  const visible = items.filter((i) => !i.hidden);
  const inner = (t: TabItem<T>) => (
    <>
      {t.icon && <span className="[&>svg]:size-4">{t.icon}</span>}
      {t.label}
      {t.count !== undefined && <Count n={t.count} />}
    </>
  );
  // Tabs that are links are navigation, not a tablist: NavLink marks the
  // current one with aria-current="page", which is what a screen reader expects
  // of a row of links.
  if (visible.some((t) => t.to)) {
    return (
      <nav aria-label={label} className={cx('flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]', className)}>
        {visible.map((t) => (
          <NavLink key={t.id} to={t.to ?? '#'} end className={({ isActive }) => cx(TAB, isActive && TAB_ON)}>
            {inner(t)}
          </NavLink>
        ))}
      </nav>
    );
  }
  // Arrow keys move between tabs, as WAI-ARIA tabs expect.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]'));
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    next.click();
    e.preventDefault();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
      className={cx('flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]', className)}
    >
      {visible.map((t) => {
        const on = t.id === value;
        return (
          <button key={t.id} type="button" role="tab" data-tab={t.id} aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange?.(t.id)} className={cx(TAB, on && TAB_ON)}>
            {inner(t)}
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  items: { id: T; label: ReactNode; icon?: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  label?: string;
  size?: 'sm' | 'md';
}

export function Segmented<T extends string>({ items, value, onChange, className, label, size = 'md' }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex gap-0.5 rounded-ctl border border-line bg-bg-2 p-[3px]', className)}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(it.id)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-[5px] px-3 font-medium transition-colors duration-[var(--dur-fast)] [&>svg]:size-3.5',
              size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[13px]',
              on ? 'bg-surface-3 text-fg shadow-e1' : 'text-fg-2 hover:text-fg',
            )}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
