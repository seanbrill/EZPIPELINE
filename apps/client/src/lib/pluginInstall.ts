/**
 * Plugin installs that keep going while you move on (setup step 5, and later
 * Settings › Plugins). One at a time, because each runs a package manager on
 * the host and two at once fight over its lock. The log of each is kept so a
 * failure can be shown with what it said.
 */
import API_URL from '../config/api';

export type InstallState = 'queued' | 'installing' | 'installed' | 'failed';
export interface Install { id: string; state: InstallState; log: string }

const jobs = new Map<string, Install>();
const listeners = new Set<() => void>();
let running = false;
let snapshot: Install[] = [];

const emit = () => { snapshot = [...jobs.values()]; listeners.forEach((l) => l()); };

export function subscribeInstalls(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const installsSnapshot = () => snapshot;

async function pump() {
  if (running) return;
  running = true;
  for (;;) {
    const next = [...jobs.values()].find((j) => j.state === 'queued');
    if (!next) break;
    next.state = 'installing'; emit();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/plugins/${encodeURIComponent(next.id)}/install`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok || !res.body) throw new Error(`The server answered ${res.status}.`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        next.log += dec.decode(value, { stream: true });
        emit();
      }
      // The stream ends with DONE or ERROR: <why>.
      next.state = /\nERROR:/.test(next.log) || !/\nDONE\s*$/.test(next.log) ? 'failed' : 'installed';
    } catch (e) {
      next.log += `\n${(e as Error).message}`;
      next.state = 'failed';
    }
    emit();
  }
  running = false;
}

export function queueInstalls(ids: string[]) {
  for (const id of ids) {
    const j = jobs.get(id);
    if (!j || j.state === 'failed') jobs.set(id, { id, state: 'queued', log: '' });
  }
  emit();
  void pump();
}
