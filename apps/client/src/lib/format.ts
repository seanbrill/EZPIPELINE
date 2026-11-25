import { formatDistanceToNowStrict } from 'date-fns';

/** "4 minutes ago", or the fallback when there is no date. SQLite's "YYYY-MM-DD HH:MM:SS" is UTC. */
export function ago(at: string | null | undefined, fallback = 'Never'): string {
  if (!at) return fallback;
  const d = new Date(/^\d{4}-\d\d-\d\d \d/.test(at) ? at.replace(' ', 'T') + 'Z' : at);
  if (Number.isNaN(d.getTime())) return fallback;
  if (Date.now() - d.getTime() < 45_000) return 'just now';
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function toDate(at: string): Date {
  return new Date(/^\d{4}-\d\d-\d\d \d/.test(at) ? at.replace(' ', 'T') + 'Z' : at);
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function uptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
