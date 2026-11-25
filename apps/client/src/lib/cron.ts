/**
 * Just enough cron for the Schedule tab: five fields (minute hour day month
 * weekday) with *, lists, ranges and steps, described in words and walked
 * forward to find the next times. The server (node-cron) is what runs them.
 */
const RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function field(src: string, [lo, hi]: [number, number], dow = false): Set<number> | null {
  const out = new Set<number>();
  for (const part of src.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const step = m[4] ? Number(m[4]) : 1;
    let a = m[1] === '*' ? lo : Number(m[2]);
    let b = m[1] === '*' ? hi : m[3] != null ? Number(m[3]) : m[4] ? hi : a;
    if (dow) { if (a === 7) a = 0; if (b === 7) b = 6; }
    if (step < 1 || a < lo || b > hi || a > b) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const sets = f.map((x, i) => field(x, RANGES[i], i === 4));
  if (sets.some((s) => !s)) return null;
  return { min: sets[0]!, hour: sets[1]!, dom: sets[2]!, mon: sets[3]!, dow: sets[4]!, domAny: f[2] === '*', dowAny: f[4] === '*' };
}

/** The next `n` times after `from`, in local time. Empty when the expression is invalid or never fires within a year. */
export function nextTimes(expr: string, n = 3, from = new Date()): Date[] {
  const c = parseCron(expr);
  if (!c) return [];
  const out: Date[] = [];
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60 && out.length < n; i++) {
    const dayOk = c.domAny && c.dowAny ? true : c.domAny ? c.dow.has(d.getDay()) : c.dowAny ? c.dom.has(d.getDate()) : c.dom.has(d.getDate()) || c.dow.has(d.getDay());
    if (c.mon.has(d.getMonth() + 1) && dayOk) {
      if (c.hour.has(d.getHours())) {
        if (c.min.has(d.getMinutes())) out.push(new Date(d));
        d.setMinutes(d.getMinutes() + 1);
      } else { d.setHours(d.getHours() + 1, 0); }
    } else { d.setDate(d.getDate() + 1); d.setHours(0, 0); }
  }
  return out;
}

const two = (n: number) => String(n).padStart(2, '0');

/** "Every day at 03:00", or null for something better shown as cron. */
export function describeCron(expr: string): string | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5 || !parseCron(expr)) return null;
  const [mi, h, dom, mon, dow] = f;
  const n = (s: string) => /^\d+$/.test(s);
  if (/^\*\/\d+$/.test(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${mi.slice(2)} minutes`;
  if (n(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return mi === '0' ? 'Every hour, on the hour' : `Every hour at :${two(Number(mi))}`;
  if (n(mi) && n(h) && mon === '*') {
    const at = `${two(Number(h))}:${two(Number(mi))}`;
    if (dom === '*' && dow === '*') return `Every day at ${at}`;
    if (dom === '*' && dow === '1-5') return `Weekdays at ${at}`;
    if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow)) {
      const days = dow.split(',').map((x) => DAYS[Number(x) % 7]);
      return `${days.length === 1 ? `${days[0]}s` : days.join(', ')} at ${at}`;
    }
    if (n(dom) && dow === '*') return `Day ${dom} of every month at ${at}`;
  }
  return null;
}
