/**
 * Menus (design sheet f85, f86) and, on a phone, action sheets (f88).
 *
 * The menu is drawn in a portal at a fixed position under its trigger, so a
 * card with `overflow: hidden` cannot clip it, and it flips above the trigger
 * when there is no room below. Keyboard: ↑ ↓ Home End move, Enter selects,
 * Esc closes and returns focus to the trigger, typing a letter jumps to the
 * next item that starts with it.
 */
import { cloneElement, Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cx } from './cx';
import { Modal } from './Modal';
import { useIsPhone } from '../../hooks/useMediaQuery';

export type MenuEntry =
  | {
      label: ReactNode;
      /** Used for type-ahead when the label is not plain text. */
      text?: string;
      icon?: ReactNode;
      shortcut?: string;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      hint?: ReactNode;
    }
  | { separator: true }
  | { heading: ReactNode };

interface MenuProps {
  trigger: ReactElement<{ onClick?: (e: React.MouseEvent) => void; 'aria-haspopup'?: string; 'aria-expanded'?: boolean; ref?: React.Ref<HTMLElement> }>;
  items: MenuEntry[];
  align?: 'start' | 'end';
  /** The action sheet's title on a phone. */
  title?: ReactNode;
  width?: number;
}

const isItem = (e: MenuEntry): e is Extract<MenuEntry, { onSelect: () => void }> => 'onSelect' in e;

export function Menu({ trigger, items, align = 'end', title, width = 220 }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const phone = useIsPhone();

  const close = useCallback(() => {
    setOpen(false);
    anchor?.focus();
  }, [anchor]);

  const t = cloneElement(trigger, {
    ref: setAnchor,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      trigger.props.onClick?.(e);
      setOpen((o) => !o);
    },
  });

  if (phone) {
    return (
      <>
        {t}
        <Modal open={open} onClose={() => setOpen(false)} title={title ?? 'Actions'} size="sm">
          <div className="-mx-2 flex flex-col">
            {items.map((e, i) =>
              isItem(e) ? (
                <button
                  key={i}
                  type="button"
                  disabled={e.disabled}
                  onClick={() => {
                    setOpen(false);
                    e.onSelect();
                  }}
                  className={cx(
                    'flex h-12 items-center gap-3 rounded-box px-3 text-left text-[16px] disabled:opacity-45',
                    e.danger ? 'text-fail' : 'text-fg',
                    'active:bg-surface-3 [&>svg]:size-5',
                  )}
                >
                  {e.icon}
                  <span className="flex-1">{e.label}</span>
                  {e.checked && <Check className="size-5 text-primary-hi" />}
                </button>
              ) : 'separator' in e ? (
                <span key={i} className="my-1 h-px bg-line" />
              ) : (
                <span key={i} className="px-3 pb-1 pt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">{e.heading}</span>
              ),
            )}
          </div>
        </Modal>
      </>
    );
  }

  return (
    <>
      {t}
      {open && <MenuPopover anchor={anchor} items={items} align={align} width={width} onClose={close} onPick={() => setOpen(false)} />}
    </>
  );
}

function MenuPopover({ anchor, items, align, width, onClose, onPick }: { anchor: HTMLElement | null; items: MenuEntry[]; align: 'start' | 'end'; width: number; onClose: () => void; onPick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect();
    const h = ref.current.offsetHeight;
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    const top = below ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
    let left = align === 'end' ? r.right - width : r.left;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    setPos({ top, left });
  }, [anchor, align, width]);

  useLayoutEffect(() => {
    // Measuring the rendered menu is what a layout effect is for; the second pass is intended.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    place();
    ref.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus();
  }, [place]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onPick();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, onPick, place]);

  const onKey = (e: KeyboardEvent) => {
    const all = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? []);
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => all[(n + all.length) % all.length]?.focus();
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(all.length - 1);
    else if (e.key === 'Escape') onClose();
    else if (e.key === 'Tab') onPick();
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase();
      const order = [...all.slice(i + 1), ...all.slice(0, i + 1)];
      order.find((el) => (el.dataset.text ?? el.textContent ?? '').trim().toLowerCase().startsWith(k))?.focus();
    } else return;
    e.preventDefault();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKey}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
      className="menu-enter fixed z-[150] rounded-box border border-line-2 bg-surface-2 p-[5px] shadow-e2"
    >
      {items.map((e, i) => (
        <Fragment key={i}>
          {isItem(e) ? (
            <button
              type="button"
              role="menuitem"
              data-text={e.text}
              disabled={e.disabled}
              onClick={() => {
                onPick();
                e.onSelect();
              }}
              className={cx(
                'flex h-8 w-full items-center gap-2.5 rounded-ctl px-2.5 text-left text-[13.5px] outline-none',
                'hover:bg-surface-3 focus:bg-surface-3 disabled:opacity-45 [&>svg]:size-4 [&>svg]:shrink-0',
                e.danger ? 'text-fail' : 'text-fg',
              )}
            >
              {e.icon ?? (e.checked !== undefined ? <Check className={cx('size-4', e.checked ? 'text-primary-hi' : 'invisible')} /> : null)}
              <span className="min-w-0 flex-1 truncate">{e.label}</span>
              {e.hint && <span className="text-[12px] text-fg-3">{e.hint}</span>}
              {e.shortcut && <span className="font-mono text-[11.5px] text-fg-3">{e.shortcut}</span>}
            </button>
          ) : 'separator' in e ? (
            <div role="separator" className="-mx-[5px] my-[5px] h-px bg-line" />
          ) : (
            <div className="px-2.5 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-3">{e.heading}</div>
          )}
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
