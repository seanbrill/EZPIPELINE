/**
 * The commit a run is building, always in view (f46, f66): the subject in
 * full, who wrote it and when, the branch and sha, the body, and how big it is.
 *
 * Shown from the moment the commit is known, which for a watch is before the
 * first step runs. Until then it says "Resolving commit…" rather than leaving a
 * hole, so the row never jumps when the details arrive.
 */
import { useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { ExternalLink } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { CommitChip } from './CommitChip';
import { cx } from '../ui/cx';

export interface CommitDetails {
  sha: string;
  subject: string;
  body?: string | null;
  author?: string | null;
  /** ISO date the commit was authored. */
  date?: string | null;
  branch?: string | null;
  files?: number | null;
  insertions?: number | null;
  deletions?: number | null;
  /** A web page for the commit, when the remote is a known host. */
  url?: string | null;
}

interface CommitCardProps {
  commit?: CommitDetails | null;
  /** The sha is known but its details are still being fetched. */
  resolving?: boolean;
  /** Other commits this run also carries, newest first. */
  alsoIn?: { sha: string; subject: string }[];
  compact?: boolean;
  className?: string;
}

function ago(date?: string | null) {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : `${formatDistanceToNowStrict(d)} ago`;
}

export function CommitCard({ commit, resolving, alsoIn, compact, className }: CommitCardProps) {
  const [open, setOpen] = useState(false);
  if (!commit || resolving) {
    return (
      <div className={cx('flex items-center gap-3 rounded-card border border-line bg-surface px-5 py-4', className)}>
        <span className="skel size-7 rounded-full" />
        <div className="flex-1 space-y-2">
          <span className="skel block h-3.5 w-2/3 rounded" />
          <span className="skel block h-3 w-1/3 rounded" />
        </div>
        <span className="text-[12.5px] text-fg-3">{commit?.sha ? `${commit.sha.slice(0, 7)} · ` : ''}Resolving commit…</span>
      </div>
    );
  }
  const body = commit.body?.trim();
  const long = !!body && (body.length > 220 || body.split('\n').length > 3);
  const total = (commit.insertions ?? 0) + (commit.deletions ?? 0);
  return (
    <div className={cx('rounded-card border border-line bg-surface px-5 py-4', className)}>
      <div className="flex items-start gap-3">
        <Avatar name={commit.author || '?'} size={28} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-4">
            <p className={cx('min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-fg', compact && 'truncate')}>{commit.subject}</p>
            {commit.url && (
              <a href={commit.url} target="_blank" rel="noreferrer" className="hidden shrink-0 items-center gap-1 text-[13px] font-medium text-primary-hi hover:underline sm:inline-flex">
                View on GitHub <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]">
            {commit.author && <span className="font-medium text-fg">{commit.author}</span>}
            {ago(commit.date) && <span className="text-fg-3">authored {ago(commit.date)}</span>}
            <span className="h-3.5 w-px bg-line-2" aria-hidden="true" />
            <CommitChip sha={commit.sha} branch={commit.branch} />
            {commit.files != null && (
              <span className="font-mono text-[12px] text-fg-3">
                {commit.files} {commit.files === 1 ? 'file' : 'files'}{' '}
                <span className="text-primary-hi">+{(commit.insertions ?? 0).toLocaleString()}</span>{' '}
                <span className="text-fail">−{(commit.deletions ?? 0).toLocaleString()}</span>
              </span>
            )}
            {total > 0 && (
              <span className="flex h-1.5 w-16 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                <span className="bg-primary" style={{ width: `${((commit.insertions ?? 0) / total) * 100}%` }} />
                <span className="bg-fail" style={{ width: `${((commit.deletions ?? 0) / total) * 100}%` }} />
              </span>
            )}
          </div>
          {body && !compact && (
            <div className="mt-3 border-l-2 border-line-2 pl-3.5">
              <p className={cx('whitespace-pre-line text-[13px] leading-relaxed text-fg-2', !open && long && 'line-clamp-3')}>{body}</p>
              {long && (
                <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-[12.5px] font-medium text-primary-hi hover:underline">
                  {open ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
          {alsoIn && alsoIn.length > 0 && !compact && (
            <p className="mt-2.5 truncate text-[12.5px] text-fg-3">
              Also in this run:{' '}
              {alsoIn.slice(0, 2).map((c, i) => (
                <span key={c.sha}>
                  {i > 0 && ' · '}
                  <span className="font-mono text-fg-2">{c.sha.slice(0, 7)}</span> {c.subject}
                </span>
              ))}
              {alsoIn.length > 2 && ` and ${alsoIn.length - 2} more`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
