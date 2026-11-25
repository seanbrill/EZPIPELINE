/**
 * Admin › Terminal: a shell on the host, as the EZPipeline user. It is a
 * plain shell, not a terminal emulator: type a command, press Enter, read
 * what it prints. Programs that draw a screen (vim, top) won't work here.
 * The output streams over this browser's signed-in socket and nowhere else.
 */
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Power, RotateCcw, SquareTerminal } from 'lucide-react';
import API_URL from '../../config/api';
import { api } from '../../lib/api';
import { PageHead } from '../../components/settings/kit';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Banner } from '../../components/ui/Feedback';

type State = 'connecting' | 'open' | 'ended' | 'failed';
const MAX = 200_000;

export default function Terminal() {
  const [out, setOut] = useState('');
  const [state, setState] = useState<State>('connecting');
  const [err, setErr] = useState<string | null>(null);
  const [line, setLine] = useState('');
  const [gen, setGen] = useState(0);
  const session = useRef<string | null>(null);
  const history = useRef<string[]>([]);
  const hi = useRef(-1);
  const box = useRef<HTMLPreElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('token') ?? '';
    const sock: Socket = io(API_URL || undefined, { auth: { token }, reconnection: false });
    const append = (s: string) => setOut((o) => (o + s).slice(-MAX));
    sock.on('connect', () => {
      api<{ sessionId: string }>('/terminal/create', { method: 'POST', body: { socketId: sock.id } })
        .then((r) => { session.current = r.sessionId; setState('open'); setErr(null); append(`Connected. A shell in the server’s folder.\n`); input.current?.focus(); })
        .catch((e) => { setErr((e as Error).message); setState('failed'); });
    });
    sock.on('connect_error', (e) => { setErr(e.message); setState('failed'); });
    sock.on('terminal-output', (d: { sessionId: string; data: string }) => { if (d.sessionId === session.current) append(d.data); });
    sock.on('terminal-error', (d: { sessionId: string; error: string }) => { if (d.sessionId === session.current) append(`\n${d.error}\n`); });
    sock.on('terminal-exit', (d: { sessionId: string; code: number | null }) => {
      if (d.sessionId !== session.current) return;
      append(`\nThe shell exited${d.code != null ? ` with ${d.code}` : ''}.\n`);
      session.current = null; setState('ended');
    });
    return () => {
      const id = session.current;
      session.current = null;
      if (id) void api('/terminal/kill', { method: 'POST', body: { sessionId: id } }).catch(() => {});
      sock.disconnect();
    };
  }, [gen]);

  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [out]);

  const send = () => {
    const id = session.current;
    if (!id) return;
    const cmd = line;
    setOut((o) => `${o}$ ${cmd}\n`);
    if (cmd.trim()) history.current = [cmd, ...history.current.filter((h) => h !== cmd)].slice(0, 100);
    hi.current = -1;
    setLine('');
    void api('/terminal/input', { method: 'POST', body: { sessionId: id, input: `${cmd}\n` } }).catch((e) => setErr((e as Error).message));
  };

  const end = () => {
    const id = session.current;
    if (id) void api('/terminal/kill', { method: 'POST', body: { sessionId: id } }).catch(() => {});
  };

  const restart = () => { setOut(''); setState('connecting'); setErr(null); setGen((g) => g + 1); };

  return (
    <>
      <PageHead title="Terminal" badge={state === 'open' ? <Badge tone="ok" dot live>Connected</Badge> : state === 'connecting' ? <Badge tone="run">Connecting</Badge> : <Badge>Ended</Badge>}
        lede="A shell on this host, as the user EZPipeline runs as. Opening one goes in the audit log; what you type does not, since it can hold secrets."
        action={state === 'open' ? <Button variant="danger" icon={<Power className="size-4" />} onClick={end}>End session</Button> : <Button icon={<RotateCcw className="size-4" />} onClick={restart} disabled={state === 'connecting'}>New session</Button>} />
      {err && <Banner tone="fail" className="mb-4">{err}</Banner>}
      <div className="overflow-hidden rounded-card border border-line-2 bg-log-bg" onClick={() => input.current?.focus()}>
        <pre ref={box} className="h-[min(60vh,520px)] overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] px-4 py-3 font-mono text-[length:var(--log-size,13px)] leading-[1.55] text-log-fg">
          {out || <span className="inline-flex items-center gap-2 text-fg-3"><SquareTerminal className="size-4" />Opening a shell…</span>}
        </pre>
        <form className="flex items-center gap-2 border-t border-line-2 px-4 py-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <span className="font-mono text-[13px] text-primary-hi">$</span>
          <input ref={input} value={line} disabled={state !== 'open'} spellCheck={false} autoComplete="off" autoCapitalize="off" aria-label="Command"
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              const h = history.current;
              if (e.key === 'ArrowUp' && h.length) { e.preventDefault(); hi.current = Math.min(hi.current + 1, h.length - 1); setLine(h[hi.current]); }
              if (e.key === 'ArrowDown') { e.preventDefault(); hi.current = Math.max(hi.current - 1, -1); setLine(hi.current < 0 ? '' : h[hi.current]); }
              if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); setOut(''); }
            }}
            className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[13px] text-log-fg outline-none placeholder:text-fg-3" placeholder={state === 'open' ? 'Type a command and press Enter' : ''} />
        </form>
      </div>
      <p className="mt-3 text-[12.5px] text-fg-3">↑ and ↓ go through what you typed. Ctrl+L clears. Programs that draw a full screen, like vim or top, don’t work here.</p>
    </>
  );
}
