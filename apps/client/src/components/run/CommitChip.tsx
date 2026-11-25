/**
 * `main@5ad62f7`: where a run's code came from, in one mono chip (f46).
 * Click copies the full sha; the chip flashes "Copied" (f122).
 */
import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import { cx } from '../ui/cx';

interface CommitChipProps {
  sha?: string | null;
  branch?: string | null;
  /** No sha known: say how the run was started instead ("manual · main"). */
  fallback?: string;
  copyable?: boolean;
  className?: string;
}

export function CommitChip({ sha, branch, fallback, copyable = true, className }: CommitChipProps) {
  const [copied, setCopied] = useState(false);
  const short = sha ? sha.slice(0, 7) : null;
  const text = short ? (branch ? `${branch}@${short}` : short) : fallback ?? (branch ? branch : '—');
  const base = cx(
    'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[5px] border border-line-2 bg-bg-2 px-1.5',
    'font-mono text-[11.5px] text-fg-2 whitespace-nowrap',
    className,
  );
  if (!sha || !copyable) {
    return (
      <span className={base}>
        {sha && <GitBranch className="size-3 text-fg-3" aria-hidden="true" />}
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`Copy ${sha}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(sha).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={cx(base, 'transition-colors hover:border-line-3 hover:text-fg', copied && '!border-primary-line !text-primary-hi')}
    >
      <GitBranch className="size-3 text-fg-3" aria-hidden="true" />
      {copied ? 'Copied' : text}
    </button>
  );
}
