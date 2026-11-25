/**
 * Toasts (design sheet f67, f68, f113).
 *
 * The four calls the app has always used still work:
 *   toast.success('Saved')     toast.error(message, { duration: 8000 })
 * and each takes richer options now: a description, a commit to show, and one
 * action button.
 *
 * Placement: bottom right, 24px from the edge, lifted above the assistant
 * button; 380 wide; newest on top; at most three, so a fourth pushes the oldest
 * out. Hovering the stack pauses every timer. On a phone: top, full width, one
 * at a time with a "+N", swipe up to dismiss.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Toaster } from '../components/common/Toast';

export type ToastTone = 'success' | 'error' | 'warning' | 'info' | 'running';

export interface ToastOptions {
  duration?: number;
  /** A second line under the message. */
  description?: ReactNode;
  /** Shown as a branch@sha chip with its subject, like everywhere else. */
  commit?: { sha: string; branch?: string; subject?: string };
  action?: { label: string; onClick: () => void };
  /** Stay until dismissed. */
  sticky?: boolean;
}

export interface ToastItem extends ToastOptions {
  id: string;
  tone: ToastTone;
  title: ReactNode;
  /** Set when it starts its exit; it is removed once the exit has played. */
  leavingAt?: number;
}

interface ToastApi {
  success: (message: ReactNode, options?: ToastOptions) => string;
  error: (message: ReactNode, options?: ToastOptions) => string;
  warning: (message: ReactNode, options?: ToastOptions) => string;
  info: (message: ReactNode, options?: ToastOptions) => string;
  running: (message: ReactNode, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

// Long enough to read a sentence and a commit subject; errors get longer
// because they usually need reading twice.
const DEFAULT_MS: Record<ToastTone, number> = { success: 5000, info: 5000, running: 5000, warning: 7000, error: 9000 };
const MAX = 3;
const EXIT_MS = 180;

const ToastContext = createContext<ToastApi | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Drop every toast whose exit has finished playing.
  const sweepSoon = useCallback(() => {
    window.setTimeout(() => {
      const cutoff = Date.now() - EXIT_MS + 10;
      setToasts((ts) => ts.filter((t) => !t.leavingAt || t.leavingAt > cutoff));
    }, EXIT_MS);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      const now = Date.now();
      setToasts((ts) => ts.map((t) => (t.id === id && !t.leavingAt ? { ...t, leavingAt: now } : t)));
      sweepSoon();
    },
    [sweepSoon],
  );

  const add = useCallback(
    (tone: ToastTone, title: ReactNode, options: ToastOptions = {}) => {
      const id = Math.random().toString(36).slice(2, 10);
      const now = Date.now();
      const item: ToastItem = { id, tone, title, ...options, duration: options.duration ?? DEFAULT_MS[tone] };
      setToasts((ts) => {
        const live = ts.filter((t) => !t.leavingAt);
        const leaving = ts.filter((t) => t.leavingAt);
        // Newest first; whatever falls past MAX starts leaving.
        const next = [item, ...live].map((t, i) => (i >= MAX ? { ...t, leavingAt: now } : t));
        return [...next, ...leaving];
      });
      sweepSoon();
      return id;
    },
    [sweepSoon],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => add('success', m, o),
      error: (m, o) => add('error', m, o),
      warning: (m, o) => add('warning', m, o),
      info: (m, o) => add('info', m, o),
      running: (m, o) => add('running', m, o),
      dismiss,
    }),
    [add, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
