/**
 * The sign-in layout (design sheet f8, f9; phone f18): the form on the left,
 * a pipeline you can read on the right. The right half is decoration and
 * goes away on a phone.
 */
import { useRef, type ReactNode, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Logo } from '../brand/Logo';
import { cx } from '../ui/cx';
import { VERSION } from '../../lib/instance';

const SAMPLE = [
  ['name', ': Static site'], ['steps', ':'], ['  - name', ': Install'], ['    run', ': npm ci'],
  ['  - name', ': Build'], ['    run', ': npm run build'], ['  - name', ': Deploy'], ['    run', ': filefreak sites deploy dist --site my-site'],
];

function Showcase() {
  return (
    <div className="relative hidden flex-1 items-center overflow-hidden border-l border-line bg-bg-2 px-16 lg:flex">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-primary/10 blur-3xl" />
      <div className="relative w-full max-w-[520px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[12px] font-medium text-primary-hi"><span className="size-1.5 rounded-full bg-primary" />Self-hosted · open source</span>
        <h2 className="mt-4 text-[32px] font-semibold tracking-[-0.02em]">Pipelines you can read.</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-fg-2">A YAML file. Steps run in order as shell commands on your host, and the log streams to your browser as it happens.</p>
        <div className="mt-8 overflow-hidden rounded-card border border-line-2 bg-surface shadow-e2">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 font-mono text-[12.5px] text-fg-2">
            <span className="text-fg-3">&gt;_</span>static-site.yml
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-sans text-[11.5px] text-primary-hi"><span className="size-1.5 rounded-full bg-primary" />Succeeded · 41s</span>
          </div>
          <pre className="bg-log-bg px-4 py-3 font-mono text-[12.5px] leading-[1.7]">
            {SAMPLE.map(([k, v], i) => (
              <div key={i}><span className="mr-4 inline-block w-3 text-right text-fg-3">{i + 1}</span><span className={k.includes('run') ? 'text-run' : 'text-log-fg'}>{k}</span><span className={k.includes('run') ? 'text-run' : 'text-log-fg'}>{v}</span></div>
            ))}
          </pre>
          <div className="border-t border-line px-4 py-3">
            <div className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="h-1 flex-1 rounded-full bg-primary" />)}</div>
            <div className="mt-2 flex justify-between font-mono text-[11.5px] text-fg-3"><span className="font-sans">3 of 3 steps</span><span>Install 18s · Build 15s · Deploy 8s</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      <div className="flex w-full flex-col px-6 py-6 sm:px-12 lg:w-1/2 lg:max-w-[720px]">
        <Logo size={28} />
        <main id="main" className="flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-[380px]">{children}</div>
        </main>
        <footer className="flex items-center justify-between text-[12px] text-fg-3">
          <span className="font-mono">EZPipeline v{VERSION} · Apache 2.0</span>
          <span className="flex gap-4"><a className="hover:text-fg" href="/docs">Docs</a><a className="hover:text-fg" href="https://github.com/seanbrill/EZPIPELINE" target="_blank" rel="noreferrer">GitHub</a></span>
        </footer>
      </div>
      <Showcase />
    </div>
  );
}

/** Six boxes for an email code: type, paste the whole code, backspace across boxes. */
export function CodeInput({ value, onChange, onComplete, disabled }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const set = (next: string) => {
    const v = next.replace(/\D/g, '').slice(0, 6);
    onChange(v);
    if (v.length === 6) onComplete?.(v);
    refs.current[Math.min(v.length, 5)]?.focus();
  };
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) { e.preventDefault(); set(value.slice(0, i - 1)); }
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };
  const onPaste = (e: ClipboardEvent) => { e.preventDefault(); set(e.clipboardData.getData('text')); };
  return (
    <div className="flex items-center gap-2" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <span key={i} className="contents">
          {i === 3 && <span aria-hidden className="text-fg-3">–</span>}
          <input
            ref={(el) => { refs.current[i] = el; }}
            inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={1} disabled={disabled}
            aria-label={`Digit ${i + 1}`} value={d} autoFocus={i === 0}
            onChange={(e) => { const c = e.target.value.replace(/\D/g, '').slice(-1); set((value.slice(0, i) + c + value.slice(i + 1)).slice(0, 6)); }}
            onKeyDown={(e) => onKey(i, e)} onPaste={onPaste}
            className={cx('h-14 w-12 rounded-box border bg-surface text-center font-mono text-[22px] text-fg outline-none transition-colors focus:border-primary focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_25%,transparent)]', d ? 'border-line-3' : 'border-line-2')}
          />
        </span>
      ))}
    </div>
  );
}
