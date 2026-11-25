/**
 * Asks before leaving unsaved edits (design sheet f61): on a tab change (call
 * the returned function), on any in-app link, and on closing or reloading the
 * page. The app uses BrowserRouter, which has no navigation blocker, so links
 * are caught on their way to the router instead.
 */
import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '../contexts/ConfirmationContext';

export function useUnsavedGuard(dirty: boolean) {
  const { confirm } = useConfirm();
  const nav = useNavigate();
  const ask = useCallback(() => confirm({
    title: 'Leave without saving?',
    message: 'Your changes to this pipeline are not saved. Leaving throws them away.',
    confirmText: 'Discard changes', cancelText: 'Keep editing', isDangerous: true,
  }), [confirm]);

  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname + url.search === location.pathname + location.search) return;
      e.preventDefault();
      e.stopPropagation();
      void ask().then((ok) => { if (ok) nav(url.pathname + url.search + url.hash); });
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty, ask, nav]);

  return useCallback(async (proceed: () => void) => { if (!dirty || (await ask())) proceed(); }, [dirty, ask]);
}
