/**
 * What a page puts in the shell's top bar: its breadcrumbs and its one
 * primary action. A page calls usePageChrome; the shell draws it.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface Crumb {
  label: string;
  to?: string;
}

export interface Chrome {
  crumbs: Crumb[];
  /** The page's primary action (desktop top bar; the phone app bar shows it as an icon if it fits). */
  action?: ReactNode;
}

const Ctx = createContext<{ chrome: Chrome; set: (c: Chrome) => void } | null>(null);

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, set] = useState<Chrome>({ crumbs: [] });
  return <Ctx.Provider value={{ chrome, set }}>{children}</Ctx.Provider>;
}

export function useChrome(): Chrome {
  return useContext(Ctx)?.chrome ?? { crumbs: [] };
}

/** Set the top bar for as long as the calling page is mounted. */
export function usePageChrome(crumbs: Crumb[], action?: ReactNode, deps: unknown[] = []) {
  const ctx = useContext(Ctx);
  const key = crumbs.map((c) => c.label + (c.to ?? '')).join('|');
  useEffect(() => {
    ctx?.set({ crumbs, action });
    document.title = crumbs.length ? `${crumbs[crumbs.length - 1].label} · EZPipeline` : 'EZPipeline';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
}
