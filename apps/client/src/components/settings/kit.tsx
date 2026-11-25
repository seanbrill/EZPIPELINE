/**
 * The pieces Settings and Admin are made of (design sheet f21–f35, f145–f148):
 * a grouped sub-nav on the left (a list of rows on a phone, f27), a page head
 * with at most one primary, and blocks that put the label on the left and the
 * controls on the right so a page scans down one column.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cx } from '../ui/cx';

export interface NavItem { id: string; label: string; icon: ReactNode; count?: number; dot?: boolean; value?: string; hidden?: boolean }
export interface NavGroup { label: string; items: NavItem[]; note?: string }

export function SubNav({ base, groups, current }: { base: string; groups: NavGroup[]; current: string }) {
  return (
    <nav aria-label="Sections" className="sticky top-6 flex w-[200px] shrink-0 flex-col self-start">
      {groups.map((g, gi) => (
        <div key={g.label} className={cx(gi > 0 && 'mt-6')}>
          <div className="mb-2 px-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">{g.label}</div>
          {g.items.filter((i) => !i.hidden).map((i) => (
            <Link key={i.id} to={`${base}/${i.id}`} aria-current={current === i.id ? 'page' : undefined}
              className={cx('flex h-9 items-center gap-2.5 rounded-ctl px-2.5 text-[14px] [&>svg]:size-4', current === i.id ? 'bg-surface-3 font-medium text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg')}>
              {i.icon}<span className="flex-1">{i.label}</span>
              {i.count != null && <span className="rounded-full border border-line-2 px-1.5 font-mono text-[11px] text-fg-3">{i.count}</span>}
              {i.dot && <span className="size-1.5 rounded-full bg-primary" />}
            </Link>
          ))}
          {g.note && <p className="mt-3 px-2.5 text-[12.5px] text-fg-3">{g.note}</p>}
        </div>
      ))}
    </nav>
  );
}

/** The phone version (f27): one grouped list, each row with its current value. */
export function NavList({ base, groups }: { base: string; groups: NavGroup[] }) {
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.label}>
          <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">{g.label}</div>
          <div className="overflow-hidden rounded-card border border-line-2 bg-surface">
            {g.items.filter((i) => !i.hidden).map((i) => (
              <Link key={i.id} to={`${base}/${i.id}`} className="flex h-[52px] items-center gap-3 border-b border-line px-4 text-[15px] last:border-0 [&>svg]:size-[18px] [&>svg]:text-fg-2">
                {i.icon}<span className="flex-1">{i.label}</span>
                {i.value && <span className="max-w-[45%] truncate text-[13.5px] text-fg-3">{i.value}</span>}
                <ChevronRight className="!size-4 text-fg-3" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function PageHead({ title, lede, action, badge }: { title: ReactNode; lede?: ReactNode; action?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="text-[24px] font-semibold tracking-[-0.01em]">{title}</h1>{badge}</div>
        {lede && <p className="mt-1.5 max-w-[640px] text-[14px] leading-relaxed text-fg-2">{lede}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Blk({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-line py-6 first-of-type:border-t-0 first-of-type:pt-0 md:grid-cols-[220px_minmax(0,1fr)] md:gap-8">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {desc && <p className="mt-1 text-[13px] leading-relaxed text-fg-3">{desc}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** A two-column split: sub-nav and the page. On a phone the page stands alone with a back link. */
export function SplitLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-10">
      <div className="hidden lg:block">{nav}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
