import { cx } from './cx';

/** Initials from a display name: "Sean Brill" → "SB", "github-actions[bot]" → "GA". */
export function initials(name: string): string {
  const words = name.replace(/\[bot\]$/i, '').split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// A person keeps the same colour everywhere: picked from their name, not random.
const HUES = [
  'from-[#6ee7b7] to-[#10b981]',
  'from-[#a5b4fc] to-[#8b5cf6]',
  'from-[#7dd3fc] to-[#0ea5e9]',
  'from-[#fcd34d] to-[#f59e0b]',
  'from-[#fda4af] to-[#f43f5e]',
];

export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      title={name}
      aria-hidden="true"
      className={cx('grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-semibold text-primary-ink', HUES[h % HUES.length], className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {initials(name)}
    </span>
  );
}
