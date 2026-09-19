import { useEffect, useMemo, useState, type JSX } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { KEYBOARD_MAP, useKeyboard, type KeyBinding } from '@/hooks/useKeyboard';
import { ROUTES } from '@/lib/constants';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { KeyboardHelp } from './KeyboardHelp';
import { cn } from '@/lib/cn';

/**
 * `g <key>` destinations, in one lookup so the map and the handler cannot drift.
 */
const GOTO: Record<string, string> = {
  p: ROUTES.policies,
  n: ROUTES.principals,
  r: ROUTES.resources,
  s: ROUTES.scenarios,
  e: ROUTES.evaluate,
  i: ROUTES.impact,
  g: ROUTES.graph,
  t: ROUTES.timeline,
  a: ROUTES.audit,
};

/**
 * The authenticated shell: skip link, sidebar, header, routed content.
 *
 * Global shortcuts live here (Plan §15.4). `useKeyboard` already ignores
 * keystrokes while a text field or `data-keyboard-scope="editor"` element has
 * focus, so typing an ARN never triggers `g` navigation.
 */
export function AppShell(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const focusMode = useUiStore((state) => state.focusMode);
  const toggleFocusMode = useUiStore((state) => state.toggleFocusMode);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const toggleKeyboardHelp = useUiStore((state) => state.toggleKeyboardHelp);
  const setKeyboardHelpOpen = useUiStore((state) => state.setKeyboardHelpOpen);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Route change closes the mobile drawer so the new page is immediately visible.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const bindings = useMemo<KeyBinding[]>(() => {
    const list: KeyBinding[] = [
      {
        id: 'palette',
        keys: 'mod+k',
        description: 'Open command palette',
        group: 'Global',
        allowInInput: true,
        handler: () => setPaletteOpen(true),
      },
      {
        id: 'help',
        keys: '?',
        description: 'Keyboard shortcuts',
        group: 'Global',
        handler: () => toggleKeyboardHelp(),
      },
      {
        id: 'search',
        keys: '/',
        description: 'Focus search',
        group: 'Global',
        handler: () => {
          // Prefer the page's own search box, then the palette.
          const input = document.querySelector<HTMLInputElement>('[data-search-input]');
          if (input) {
            input.focus();
            input.select();
            return;
          }
          setPaletteOpen(true, '');
        },
      },
      {
        id: 'escape',
        keys: 'escape',
        description: 'Close / cancel',
        group: 'Global',
        when: () => !mobileNavOpen,
        handler: () => {
          setKeyboardHelpOpen(false);
          setPaletteOpen(false);
        },
      },
      {
        id: 'focus-mode',
        keys: 'mod+.',
        description: 'Toggle focus mode',
        group: 'Global',
        allowInInput: true,
        handler: () => toggleFocusMode(),
      },
      {
        id: 'create',
        keys: 'c',
        description: 'Create (context aware)',
        group: 'Create',
        handler: () => {
          const mapping: Record<string, string> = {
            [ROUTES.policies]: 'policy',
            [ROUTES.principals]: 'principal',
            [ROUTES.resources]: 'resource',
            [ROUTES.scenarios]: 'scenario',
          };
          const kind = mapping[location.pathname];
          if (kind === undefined) {
            setPaletteOpen(true, 'create');
            return;
          }
          const params = new URLSearchParams(location.search);
          params.set('new', kind);
          navigate({ pathname: location.pathname, search: params.toString() });
        },
      },
      {
        id: 'evaluate-selected',
        keys: 'e',
        description: 'Evaluate selected',
        group: 'Actions',
        handler: () => navigate(ROUTES.evaluate),
      },
      {
        id: 'close-mobile-nav',
        keys: 'escape',
        description: 'Close navigation drawer',
        group: 'Global',
        when: () => mobileNavOpen,
        handler: () => setMobileNavOpen(false),
      },
    ];

    for (const [key, to] of Object.entries(GOTO)) {
      list.push({
        id: `goto-${key}`,
        keys: `g ${key}`,
        description: `Go to ${to}`,
        group: 'Navigation',
        handler: () => navigate(to),
      });
    }

    return list;
  }, [
    location.pathname,
    location.search,
    mobileNavOpen,
    navigate,
    setKeyboardHelpOpen,
    setPaletteOpen,
    toggleFocusMode,
    toggleKeyboardHelp,
  ]);

  useKeyboard(bindings);

  // `KEYBOARD_MAP` is the documentation source of truth; keep it referenced so a
  // binding cannot be removed from the map without the help overlay noticing.
  const documented = useMemo(() => new Set(KEYBOARD_MAP.map((entry) => entry.keys)), []);

  // A `g` sequence is armed in useKeyboard; nothing to do here, but we surface
  // the documented count in dev to catch drift early.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    for (const binding of bindings) {
      if (!documented.has(binding.keys) && binding.keys !== 'escape' && binding.keys !== 'mod+.') {
        console.warn(`[keyboard] "${binding.keys}" is bound but missing from KEYBOARD_MAP`);
      }
    }
  }, [bindings, documented]);

  const signedIn = useSessionStore((state) => state.user !== null);

  return (
    <div className="flex h-full flex-col bg-bg">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <Header
        onToggleMobileNav={() => setMobileNavOpen((previous) => !previous)}
        mobileNavOpen={mobileNavOpen}
      />

      <div className="flex min-h-0 flex-1">
        {focusMode || !signedIn ? null : (
          <div className={cn('hidden lg:block', mobileNavOpen && 'hidden')}>
            <Sidebar />
          </div>
        )}

        {mobileNavOpen ? (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileNavOpen(false)}
            />
            <div className="relative z-10 h-full">
              <Sidebar />
            </div>
          </div>
        ) : null}

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-y-auto px-4 py-4 outline-none lg:px-6"
        >
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette />
      <KeyboardHelp />
    </div>
  );
}
