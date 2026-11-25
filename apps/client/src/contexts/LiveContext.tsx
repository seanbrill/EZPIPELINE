/**
 * The instance as the signed-in person can see it, kept live.
 *
 * One place owns the pipelines, the run history and the event stream, so the
 * sidebar, the palette, the notification centre and every page read the same
 * data instead of each fetching (and each forgetting to refresh) their own.
 *
 * The stream reconnects. v1's EventSource had no onerror: the ticket it opened
 * with is single-use, so after any drop (a restart, a laptop lid) it retried
 * with a spent ticket forever and the dashboard froze on a "running" build.
 * Here a drop closes the socket, fetches a fresh ticket and reopens with
 * backoff, and history is polled while the stream is down.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import API_URL from '../config/api';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';
import type { BuildHistoryEntry, Commit, LogLine, PipelineInfo } from '../types/build';

export type Connection = 'connecting' | 'live' | 'retrying' | 'offline';

export interface StreamEvent {
  type: string;
  buildId?: string;
  pipelineId?: string;
  data?: unknown;
}

export interface Notice {
  id: string;
  kind: 'failed' | 'approval' | 'succeeded' | 'aborted';
  at: string;
  run: BuildHistoryEntry;
}

interface LiveState {
  pipelines: PipelineInfo[];
  history: BuildHistoryEntry[];
  loaded: boolean;
  error: string | null;
  connection: Connection;
  refresh: () => Promise<void>;
  onLine: (fn: (l: LogLine) => void) => () => void;
  onEvent: (fn: (e: StreamEvent) => void) => () => void;
  /** Commit details a git watch resolved before its run existed, by sha. */
  resolved: Record<string, Commit>;
  notices: Notice[];
  unread: number;
  seenAt: string | null;
  markAllRead: () => void;
}

const LiveContext = createContext<LiveState | null>(null);

const NOTICE_WINDOW_MS = 7 * 24 * 3600e3;

function noticesFrom(history: BuildHistoryEntry[]): Notice[] {
  const since = Date.now() - NOTICE_WINDOW_MS;
  const out: Notice[] = [];
  for (const run of history) {
    const at = run.endTime ?? run.startTime;
    if (!at || Date.parse(at) < since) continue;
    const kind = run.status === 'paused' ? 'approval' : run.status === 'failed' || run.status === 'error' ? 'failed' : run.status === 'success' ? 'succeeded' : run.status === 'aborted' ? 'aborted' : null;
    if (kind) out.push({ id: `${run.id}:${kind}`, kind, at, run });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50);
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [history, setHistory] = useState<BuildHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [resolved, setResolved] = useState<Record<string, Commit>>({});
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const lineSubs = useRef(new Set<(l: LogLine) => void>());
  const eventSubs = useRef(new Set<(e: StreamEvent) => void>());

  const refresh = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([
        api<{ targets: PipelineInfo[] }>('/targets'),
        api<{ history: BuildHistoryEntry[] }>('/builds/history'),
      ]);
      setPipelines(t.targets ?? []);
      setHistory(h.history ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  // History refreshes after stream events, at most every 400ms.
  const pendingRefresh = useRef<number | null>(null);
  const refreshSoon = useCallback(() => {
    if (pendingRefresh.current) return;
    pendingRefresh.current = window.setTimeout(() => {
      pendingRefresh.current = null;
      void refresh();
    }, 400);
  }, [refresh]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void refresh();
    api<{ state: Record<string, unknown> }>('/me/state')
      .then((r) => setSeenAt(typeof r.state['notifications.seenAt'] === 'string' ? (r.state['notifications.seenAt'] as string) : null))
      .catch(() => {});
  }, [isAuthenticated, refresh]);

  // The stream.
  useEffect(() => {
    if (!token) return;
    let es: EventSource | null = null;
    let closed = false;
    let attempt = 0;
    let retry: number | null = null;

    const open = async () => {
      setConnection(attempt === 0 ? 'connecting' : 'retrying');
      try {
        const { ticket } = await api<{ ticket: string }>('/logs-stream/ticket', { method: 'POST' });
        if (closed) return;
        es = new EventSource(`${API_URL}/api/logs-stream?ticket=${encodeURIComponent(ticket)}`);
        es.onopen = () => {
          if (attempt > 0) void refresh(); // catch up on what happened while away
          attempt = 0;
          setConnection('live');
        };
        es.onmessage = (ev) => {
          let p: Record<string, unknown>;
          try { p = JSON.parse(ev.data); } catch { return; }
          if (p.type === 'connected') return;
          if (p.type === 'log') {
            if (typeof p.buildId !== 'string') return;
            const line: LogLine = {
              buildId: p.buildId, pipelineId: p.pipelineId as string, stepIndex: (p.stepIndex as number | null) ?? null, substep: (p.substep as string | null) ?? null,
              stream: (p.stream as LogLine['stream']) ?? null, level: p.level as string, text: String(p.text ?? ''), at: p.timestamp as string,
            };
            lineSubs.current.forEach((fn) => fn(line));
            return;
          }
          const e: StreamEvent = { type: String(p.type), buildId: p.buildId as string, pipelineId: p.pipelineId as string, data: p.data };
          if (e.type === 'commit_resolved') {
            const commits = ((p.data as { commits?: Commit[] })?.commits ?? []);
            setResolved((r) => {
              const next = { ...r };
              for (const c of commits) next[c.sha] = c;
              return next;
            });
          }
          eventSubs.current.forEach((fn) => fn(e));
          refreshSoon();
        };
        es.onerror = () => {
          es?.close();
          es = null;
          if (closed) return;
          attempt += 1;
          setConnection(attempt > 3 ? 'offline' : 'retrying');
          const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
          retry = window.setTimeout(open, wait);
        };
      } catch {
        if (closed) return;
        attempt += 1;
        setConnection(attempt > 3 ? 'offline' : 'retrying');
        retry = window.setTimeout(open, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
      }
    };
    void open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [token, refresh, refreshSoon]);

  // While the stream is down, poll so the page does not freeze.
  useEffect(() => {
    if (connection === 'live' || !token) return;
    const t = window.setInterval(() => void refresh(), 12_000);
    return () => clearInterval(t);
  }, [connection, token, refresh]);

  const onLine = useCallback((fn: (l: LogLine) => void) => {
    lineSubs.current.add(fn);
    return () => { lineSubs.current.delete(fn); };
  }, []);
  const onEvent = useCallback((fn: (e: StreamEvent) => void) => {
    eventSubs.current.add(fn);
    return () => { eventSubs.current.delete(fn); };
  }, []);

  const notices = useMemo(() => noticesFrom(history), [history]);
  const unread = useMemo(
    () => notices.filter((n) => n.kind === 'approval' || !seenAt || Date.parse(n.at) > Date.parse(seenAt)).length,
    [notices, seenAt],
  );
  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setSeenAt(now);
    void api('/me/state/notifications.seenAt', { method: 'PUT', body: { value: now } }).catch(() => {});
  }, []);

  const value = useMemo<LiveState>(
    () => ({ pipelines, history, loaded, error, connection, refresh, onLine, onEvent, resolved, notices, unread, seenAt, markAllRead }),
    [pipelines, history, loaded, error, connection, refresh, onLine, onEvent, resolved, notices, unread, seenAt, markAllRead],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  const v = useContext(LiveContext);
  if (!v) throw new Error('useLive outside LiveProvider');
  return v;
}
