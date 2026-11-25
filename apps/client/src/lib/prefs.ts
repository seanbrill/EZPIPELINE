/**
 * Per-browser display preferences (Settings › Appearance). Kept in this
 * browser, applied before the first paint so nothing jumps.
 */
export type Motion = 'system' | 'reduce';
export const LOG_SIZES = [12, 13, 14, 16] as const;

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

export function readPrefs() {
  const size = Number(get('pref.logSize'));
  return {
    motion: (get('pref.motion') === 'reduce' ? 'reduce' : 'system') as Motion,
    logSize: (LOG_SIZES as readonly number[]).includes(size) ? size : 13,
  };
}

export function applyPrefs() {
  const p = readPrefs();
  const root = document.documentElement;
  if (p.motion === 'reduce') root.setAttribute('data-motion', 'reduce'); else root.removeAttribute('data-motion');
  root.style.setProperty('--log-size', `${p.logSize}px`);
}

export function savePref(k: 'motion' | 'logSize', v: string | number) {
  set(`pref.${k}`, String(v));
  applyPrefs();
}
