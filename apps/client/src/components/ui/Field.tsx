/**
 * Form fields (design sheet f42). A Field owns the label, the hint and the
 * error, and wires them to the control by id, so screen readers announce the
 * error with the field instead of somewhere else on the page.
 */
import { cloneElement, isValidElement, useId } from 'react';
import type { InputHTMLAttributes, ReactElement, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './cx';

const CONTROL =
  'w-full rounded-ctl border border-line-2 bg-bg-2 text-fg text-[14px] placeholder:text-fg-3 ' +
  'transition-[border-color,box-shadow] duration-[var(--dur-fast)] ' +
  'focus:outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-soft)] ' +
  'disabled:opacity-55 disabled:cursor-not-allowed ' +
  'aria-[invalid=true]:border-fail aria-[invalid=true]:shadow-[0_0_0_3px_var(--fail-soft)]';

interface FieldProps {
  label?: ReactNode;
  /** Shown beside the label, e.g. a "secret" badge. */
  labelExtra?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
}

export function Field({ label, labelExtra, hint, error, className, children }: FieldProps) {
  const id = useId();
  const controlId = (isValidElement(children) && children.props.id) || id;
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={controlId} className="flex items-center gap-2 text-[12.5px] font-medium text-fg-2">
          {label}
          {labelExtra}
        </label>
      )}
      {cloneElement(children, { id: controlId, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={`${id}-err`} className="text-[12px] text-fail [overflow-wrap:anywhere]">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-fg-3 [overflow-wrap:anywhere]">{hint}</p>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  /** Something inside the field on the left, e.g. a search icon. */
  leading?: ReactNode;
  /** Something inside the field on the right, e.g. a ⌘K hint or a Reveal button. */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ mono, leading, trailing, className, ...rest }: InputProps) {
  const input = (
    <input
      className={cx(CONTROL, 'h-9 px-3', mono && 'font-mono text-[13px]', leading && 'pl-9', trailing && 'pr-24', !leading && !trailing && className)}
      {...rest}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className={cx('relative min-w-0', className)}>
      {leading && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3 [&>svg]:size-4">{leading}</span>}
      {input}
      {trailing && <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">{trailing}</span>}
    </div>
  );
}

export function Textarea({ className, mono = true, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean; ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      className={cx(CONTROL, 'min-h-24 px-3 py-2.5 leading-relaxed', mono && 'font-mono text-[12.5px]', className)}
      {...rest}
    />
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  leading?: ReactNode;
  ref?: Ref<HTMLSelectElement>;
}

/** The native select, styled. Native on purpose: on a phone it opens the OS picker. */
export function Select({ leading, className, children, ...rest }: SelectProps) {
  return (
    <div className={cx('relative min-w-0', className)}>
      {leading && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3 [&>svg]:size-4">{leading}</span>}
      <select className={cx(CONTROL, 'h-9 appearance-none pr-9', leading ? 'pl-9' : 'pl-3')} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden="true" />
    </div>
  );
}
