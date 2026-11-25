import { useSyncExternalStore } from 'react';

/** True while the media query matches; follows changes (rotation, resizing). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below 640px every modal is a bottom sheet and every menu an action sheet. */
export const PHONE_QUERY = '(max-width: 639px)';
export const useIsPhone = () => useMediaQuery(PHONE_QUERY);
