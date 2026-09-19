import { useCallback, useSyncExternalStore } from 'react';

/**
 * SSR/test-safe media query hook built on `useSyncExternalStore` so it never
 * causes a hydration mismatch or a layout shift on first paint.
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => undefined;
      }
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return defaultValue;
    }
    return window.matchMedia(query).matches;
  }, [query, defaultValue]);

  return useSyncExternalStore(subscribe, getSnapshot, () => defaultValue);
}

export const MEDIA = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
  coarsePointer: '(pointer: coarse)',
  hover: '(hover: hover)',
} as const;

export const useIsDesktop = (): boolean => useMediaQuery(MEDIA.lg);
export const useIsTablet = (): boolean => useMediaQuery(MEDIA.md);
