/**
 * Buttons (design sheet f42).
 *
 * One primary per screen: the emerald button is "the thing this page is for",
 * so a second one on the same screen makes neither of them mean that.
 * Destructive actions are `danger` (tinted) until the moment of no return,
 * which is `danger-solid` and lives only inside a confirmation.
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center whitespace-nowrap select-none border border-transparent font-medium ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--dur-fast)] ' +
  'active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&>svg]:shrink-0';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-ink font-semibold hover:bg-primary-hi ' +
    'shadow-[0_1px_0_rgba(255,255,255,.25)_inset,0_4px_14px_-4px_rgba(16,185,129,.55)]',
  secondary: 'bg-surface-3 text-fg border-line-2 shadow-e1 hover:border-line-3 hover:bg-surface-2',
  ghost: 'bg-transparent text-fg-2 hover:bg-surface-3 hover:text-fg',
  danger: 'bg-fail-soft text-fail border-fail-line hover:bg-[color-mix(in_srgb,var(--fail)_18%,transparent)]',
  'danger-solid': 'bg-fail-solid text-white font-semibold hover:brightness-110',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 gap-1.5 text-[12.5px] rounded-[4px]',
  md: 'h-9 px-3.5 gap-2 text-[13.5px] rounded-ctl',
  lg: 'h-11 px-5 gap-2 text-[15px] rounded-box',
};

const ICON_SIZE: Record<ButtonSize, string> = { sm: 'w-7', md: 'w-9', lg: 'w-11' };

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) {
  return cx(BASE, VARIANT[variant], SIZE[size], extra);
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      role="presentation"
      className={cx('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80', className)}
      style={{ width: size, height: size }}
    />
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Busy: the button keeps its width, shows a spinner and stops taking clicks. */
  loading?: boolean;
  /** What the label says while busy, e.g. "Starting…". Defaults to the label. */
  loadingText?: ReactNode;
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary', size = 'md', icon, iconRight, loading, loadingText, block,
  className, children, disabled, type = 'button', ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(buttonClass(variant, size), block && 'w-full', loading && 'cursor-progress', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon}
      {loading && loadingText ? loadingText : children}
      {!loading && iconRight}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'iconRight' | 'loadingText' | 'children'> {
  /** Required: it is the accessible name and the tooltip. */
  label: string;
  shortcut?: string;
  children: ReactNode;
  tooltip?: boolean;
}

export function IconButton({ label, shortcut, children, variant = 'ghost', size = 'md', className, tooltip = true, ...rest }: IconButtonProps) {
  const btn = (
    <Button variant={variant} size={size} aria-label={label} className={cx(ICON_SIZE[size], '!px-0', className)} {...rest}>
      {children}
    </Button>
  );
  return tooltip ? <Tooltip content={label} shortcut={shortcut}>{btn}</Tooltip> : btn;
}
