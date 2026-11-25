/**
 * Switch, Checkbox and Radio (design sheet f42).
 *
 * A Switch changes something immediately; a Checkbox is an answer that a
 * later button submits. Pick by that, not by looks.
 */
import { useId } from 'react';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cx } from './cx';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({ checked, onChange, label, description, disabled, id, className }: SwitchProps) {
  const auto = useId();
  const sid = id ?? auto;
  const control = (
    <button
      id={sid}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={description ? `${sid}-d` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-5 w-[34px] shrink-0 rounded-full transition-colors duration-[var(--dur-fast)] disabled:opacity-45',
        checked ? 'bg-primary' : 'bg-line-3',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.4)]',
          'transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]',
          checked && 'translate-x-[14px]',
        )}
      />
    </button>
  );
  if (!label) return control;
  return (
    <div className={cx('flex items-center justify-between gap-6', className)}>
      <label htmlFor={sid} className="min-w-0 cursor-pointer">
        <span className="block text-[14px] text-fg">{label}</span>
        {description && <span id={`${sid}-d`} className="block text-[13px] text-fg-3">{description}</span>}
      </label>
      {control}
    </div>
  );
}

interface CheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, onChange, label, hint, disabled, className }: CheckProps) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2.5 text-[14px] text-fg', disabled && 'cursor-not-allowed opacity-50', className)}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden="true"
        className={cx(
          'grid size-4 shrink-0 place-items-center rounded-[4px] border-[1.5px] transition-colors duration-[var(--dur-fast)]',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
          checked ? 'border-primary bg-primary text-primary-ink' : 'border-line-3',
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3.2} />}
      </span>
      {label && <span>{label}{hint && <span className="text-fg-3"> {hint}</span>}</span>}
    </label>
  );
}

interface RadioGroupProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  name?: string;
  className?: string;
}

export function RadioGroup<T extends string>({ value, onChange, options, name, className }: RadioGroupProps<T>) {
  const auto = useId();
  return (
    <div role="radiogroup" className={cx('flex flex-wrap items-center gap-x-6 gap-y-2', className)}>
      {options.map((o) => (
        <label key={o.value} className={cx('inline-flex cursor-pointer items-center gap-2.5 text-[14px] text-fg', o.disabled && 'opacity-50')}>
          <input
            type="radio" className="peer sr-only" name={name ?? auto} value={o.value}
            checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)}
          />
          <span
            aria-hidden="true"
            className={cx(
              'size-4 shrink-0 rounded-full border-[1.5px] transition-[border-width,border-color] duration-[var(--dur-fast)]',
              'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
              value === o.value ? 'border-[5px] border-primary' : 'border-line-3',
            )}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
