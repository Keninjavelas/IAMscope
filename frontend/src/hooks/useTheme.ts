import { useEffect } from 'react';
import { useMediaQuery } from './useMediaQuery';
import { useUiStore } from '@/stores/ui';
import type { DensityMode, ResolvedTheme, ThemeMode } from '@iamscope/types';

interface UseThemeResult {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  density: DensityMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setDensity: (density: DensityMode) => void;
  cycleDensity: () => void;
}

/**
 * Single source of truth for theme + density (Plan §15.2). Mirrors the resolved
 * theme onto `<html data-theme>` so every CSS token switches, and keeps
 * `data-theme="system"` in sync with the OS media query.
 */
export function useTheme(): UseThemeResult {
  const theme = useUiStore((state) => state.theme);
  const resolvedTheme = useUiStore((state) => state.resolvedTheme);
  const density = useUiStore((state) => state.density);
  const setTheme = useUiStore((state) => state.setTheme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const setDensity = useUiStore((state) => state.setDensity);
  const cycleDensity = useUiStore((state) => state.cycleDensity);
  const setResolvedTheme = useUiStore((state) => state.setResolvedTheme);

  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)', true);

  useEffect(() => {
    if (theme !== 'system') return;
    setResolvedTheme(systemPrefersDark ? 'dark' : 'light');
  }, [theme, systemPrefersDark, setResolvedTheme]);

  // Re-apply on mount in case the inline bootstrap script in index.html could not run.
  useEffect(() => {
    useUiStore.getState().applyToDocument();
  }, []);

  return { theme, resolvedTheme, density, setTheme, toggleTheme, setDensity, cycleDensity };
}

export function useDensity(): {
  density: DensityMode;
  setDensity: (density: DensityMode) => void;
  cycleDensity: () => void;
} {
  const density = useUiStore((state) => state.density);
  const setDensity = useUiStore((state) => state.setDensity);
  const cycleDensity = useUiStore((state) => state.cycleDensity);
  return { density, setDensity, cycleDensity };
}
