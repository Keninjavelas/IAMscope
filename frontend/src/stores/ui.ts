import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ACCENTS, type Accent } from '@iamscope/tokens';
import type { DensityMode, ResolvedTheme, ThemeMode } from '@iamscope/types';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function resolveTheme(theme: ThemeMode): ResolvedTheme {
  return theme === 'system' ? systemTheme() : theme;
}

export interface UiState {
  /* persisted */
  density: DensityMode;
  theme: ThemeMode;
  accent: Accent;
  sidebarCollapsed: boolean;
  focusMode: boolean;

  /* ephemeral */
  resolvedTheme: ResolvedTheme;
  paletteOpen: boolean;
  paletteInitialQuery: string;
  keyboardHelpOpen: boolean;
  reducedMotion: boolean;

  /* actions */
  setDensity: (density: DensityMode) => void;
  setTheme: (theme: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
  toggleTheme: () => void;
  cycleDensity: () => void;
  setResolvedTheme: (theme: ResolvedTheme) => void;
  setPaletteOpen: (open: boolean, initialQuery?: string) => void;
  togglePalette: () => void;
  setKeyboardHelpOpen: (open: boolean) => void;
  toggleKeyboardHelp: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleFocusMode: () => void;
  setReducedMotion: (reduced: boolean) => void;
  /** Mirrors state onto <html> so every CSS token picks it up. */
  applyToDocument: () => void;
}

const DENSITY_ORDER: readonly DensityMode[] = ['compact', 'comfortable', 'spacious'];

/** Storage key is also read by the inline bootstrap script in index.html. */
export const UI_STORAGE_KEY = 'iamscope.ui.v1';

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      density: 'compact',
      theme: 'dark',
      accent: 'blue',
      sidebarCollapsed: false,
      focusMode: false,

      resolvedTheme: 'dark',
      paletteOpen: false,
      paletteInitialQuery: '',
      keyboardHelpOpen: false,
      reducedMotion: false,

      setDensity: (density) => {
        set({ density });
        get().applyToDocument();
      },

      setTheme: (theme) => {
        set({ theme, resolvedTheme: resolveTheme(theme) });
        get().applyToDocument();
      },

      setAccent: (accent) => {
        set({ accent });
        get().applyToDocument();
      },

      toggleTheme: () => {
        const next: ThemeMode = get().resolvedTheme === 'dark' ? 'light' : 'dark';
        get().setTheme(next);
      },

      cycleDensity: () => {
        const current = DENSITY_ORDER.indexOf(get().density);
        const next = DENSITY_ORDER[(current + 1) % DENSITY_ORDER.length] ?? 'compact';
        get().setDensity(next);
      },

      setResolvedTheme: (resolvedTheme) => {
        set({ resolvedTheme });
        get().applyToDocument();
      },

      setPaletteOpen: (paletteOpen, initialQuery = '') =>
        set({ paletteOpen, paletteInitialQuery: paletteOpen ? initialQuery : '' }),

      togglePalette: () => get().setPaletteOpen(!get().paletteOpen),

      setKeyboardHelpOpen: (keyboardHelpOpen) => set({ keyboardHelpOpen }),

      toggleKeyboardHelp: () => set({ keyboardHelpOpen: !get().keyboardHelpOpen }),

      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),

      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      toggleFocusMode: () => set({ focusMode: !get().focusMode }),

      setReducedMotion: (reducedMotion) => set({ reducedMotion }),

      applyToDocument: () => {
        if (typeof document === 'undefined') return;
        const { theme, density, accent, reducedMotion } = get();
        const root = document.documentElement;
        root.setAttribute('data-theme', resolveTheme(theme));
        root.setAttribute('data-density', density);
        root.setAttribute('data-accent', accent);
        if (reducedMotion) root.setAttribute('data-reduced-motion', 'true');
        else root.removeAttribute('data-reduced-motion');
      },
    }),
    {
      name: UI_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only durable preferences are written; transient overlay state is not.
      partialize: (state) => ({
        density: state.density,
        theme: state.theme,
        accent: state.accent,
        sidebarCollapsed: state.sidebarCollapsed,
        focusMode: state.focusMode,
      }),
      merge: (persisted, current) => {
        const incoming = (persisted ?? {}) as Partial<UiState>;
        const theme = incoming.theme ?? current.theme;
        return {
          ...current,
          ...incoming,
          theme,
          resolvedTheme: resolveTheme(theme),
        };
      },
    },
  ),
);

export function selectAccent(accent: Accent): Accent {
  return ACCENTS.includes(accent) ? accent : 'blue';
}

export function isDensityMode(value: string): value is DensityMode {
  return DENSITY_ORDER.includes(value as DensityMode);
}
