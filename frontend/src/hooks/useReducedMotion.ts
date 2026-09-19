import { useEffect } from 'react';
import { useMediaQuery } from './useMediaQuery';
import { useUiStore } from '@/stores/ui';

/**
 * Respects `prefers-reduced-motion` and mirrors it onto the store + <html> so
 * both CSS (token durations collapse to 0ms) and JS animation agree.
 *
 * Returns whether motion should be suppressed. Framer Motion callers should use
 * this to decide between an animated and a static variant.
 */
export function useReducedMotion(): boolean {
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const stored = useUiStore((state) => state.reducedMotion);
  const setReducedMotion = useUiStore((state) => state.setReducedMotion);

  useEffect(() => {
    setReducedMotion(prefersReduced);
  }, [prefersReduced, setReducedMotion]);

  return prefersReduced || stored;
}
