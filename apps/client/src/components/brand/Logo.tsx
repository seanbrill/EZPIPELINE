/**
 * The EZPipeline mark: "Thread + stations" (design sheet f37).
 *
 * The E's middle bar carries the run into the Z; a white thread is the run
 * itself, stations sit where the lines meet, and the dot at the end is the
 * deploy target. The end dot is the only part that ever changes: it carries
 * the state of the newest run in places that show one (the desktop dock and
 * tray, the browser tab while something is running).
 *
 * These colours are brand art, not theme tokens: the tile is the same emerald
 * on every theme, the way an app icon is.
 */
import type { SVGProps } from 'react';

export type MarkState = 'idle' | 'running' | 'approval' | 'failed';

const TILE = '#10b981';
const INK = '#022c22';
const LIGHT = '#ecfdf5';
const END: Record<MarkState, string> = {
  idle: LIGHT,
  running: '#38bdf8',
  approval: '#fbbf24',
  failed: '#fb7185',
};

interface MarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  state?: MarkState;
  /** Draw without the emerald tile, in one colour (on emerald or in print). */
  bare?: boolean;
}

export function LogoMark({ size = 28, state = 'idle', bare = false, ...rest }: MarkProps) {
  // Below 20px the thread and stations turn to mush, so the mark keeps only the
  // letters, drawn heavier. Same rule as the 16px favicon.
  if (size < 20) return <FaviconMark size={size} {...rest} />;
  const ink = bare ? 'currentColor' : INK;
  const light = bare ? 'var(--bg)' : LIGHT;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" {...rest}>
      {!bare && <rect width="32" height="32" rx="9" fill={TILE} />}
      <path
        d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25L16 22.5H23"
        fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M6.5 16H20.5L16 22.5H25"
        fill="none" stroke={light} strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="6.5" cy="16" r="2.3" fill={ink} />
      <circle cx="6.5" cy="16" r="1.15" fill={light} />
      <circle cx="20.5" cy="16" r="2.3" fill={ink} />
      <circle cx="20.5" cy="16" r="1.15" fill={light} />
      <circle cx="25" cy="22.5" r="2.65" fill={ink} />
      <circle cx="25" cy="22.5" r={state === 'idle' ? 1.5 : 1.6} fill={state === 'idle' ? light : END[state]} />
    </svg>
  );
}

export function FaviconMark({ size = 16, ...rest }: Omit<MarkProps, 'state' | 'bare'>) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" {...rest}>
      <rect width="32" height="32" rx="8" fill={TILE} />
      <path
        d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25.5L16 22.5H25.5"
        fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

interface LogoProps {
  size?: number;
  state?: MarkState;
  className?: string;
  /** Hide the word below this width (the collapsed sidebar rail). */
  markOnly?: boolean;
}

export function Logo({ size = 28, state, className = '', markOnly = false }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-semibold tracking-[-0.02em] text-fg ${className}`}>
      <LogoMark size={size} state={state} />
      {!markOnly && (
        <span style={{ fontSize: Math.round(size * 0.57) }}>
          <b className="font-bold text-primary-hi">EZ</b>Pipeline
        </span>
      )}
      {markOnly && <span className="sr-only">EZPipeline</span>}
    </span>
  );
}
