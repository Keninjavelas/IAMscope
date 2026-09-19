import { useEffect, useMemo, useRef } from 'react';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface KeyBinding {
  /** Stable id, used as the React key in the help overlay. */
  id: string;
  /** Binding string: `'mod+k'`, `'g p'`, `'?'`, `'escape'`, `'mod+enter'`. */
  keys: string;
  description: string;
  group: KeyboardGroup;
  handler: (event: KeyboardEvent) => void;
  /** Return false to make the binding inert in the current context. */
  when?: () => boolean;
  /** Allow while a text input / contenteditable has focus. Default false. */
  allowInInput?: boolean;
  /** Fire repeatedly while held. Default false. */
  allowRepeat?: boolean;
}

export type KeyboardGroup = 'Global' | 'Navigation' | 'Create' | 'Actions' | 'Graph' | 'Timeline';

interface Options {
  enabled?: boolean;
  /** Milliseconds allowed between steps of a sequence like `g p`. */
  sequenceTimeoutMs?: number;
}

/* ------------------------------------------------------------------ */
/* Parsing / matching                                                 */
/* ------------------------------------------------------------------ */

interface ParsedStep {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const MODIFIER_KEYS = new Set(['control', 'meta', 'alt', 'shift', 'os']);

function parseStep(raw: string): ParsedStep {
  const parts = raw.split('+').map((part) => part.trim().toLowerCase());
  const step: ParsedStep = { mod: false, alt: false, shift: false, key: '' };
  for (const part of parts) {
    if (part === 'mod' || part === 'cmd' || part === 'ctrl') step.mod = true;
    else if (part === 'alt' || part === 'option') step.alt = true;
    else if (part === 'shift') step.shift = true;
    else step.key = part;
  }
  return step;
}

function parseBinding(keys: string): ParsedStep[] {
  return keys
    .trim()
    .split(/\s+/)
    .map((token) => parseStep(token));
}

function eventStep(event: KeyboardEvent): ParsedStep | null {
  const key = event.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null;
  return {
    mod: event.metaKey || event.ctrlKey,
    alt: event.altKey,
    // `?` already implies shift; requiring shift on top would never match.
    shift: event.shiftKey && key !== '?' && !/^[a-z]$/.test(key) ? true : event.shiftKey,
    key,
  };
}

function stepMatches(step: ParsedStep, actual: ParsedStep): boolean {
  if (step.key !== actual.key) return false;
  if (step.mod !== actual.mod) return false;
  if (step.alt !== actual.alt) return false;
  if (step.shift !== actual.shift) return false;
  return true;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  // CodeMirror and other rich editors mark themselves with data-* attributes.
  return target.closest('[data-keyboard-scope="editor"]') !== null;
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                    */
/* ------------------------------------------------------------------ */

// `navigator.platform` is deprecated and `navigator.userAgentData` is Chromium-only, so
// the UA string is the portable check. No `typeof navigator` guard: this is a
// browser-only SPA bundle, never evaluated on the server.
const IS_APPLE = /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  enter: 'Enter',
  ' ': 'Space',
  backspace: 'Backspace',
  delete: 'Del',
};

/** `'mod+enter'` -> `['⌘', 'Enter']` (or `['Ctrl', 'Enter']` off macOS). */
export function formatKeybinding(keys: string): string[] {
  return keys
    .trim()
    .split(/\s+/)
    .map((step) =>
      step
        .split('+')
        .map((part) => {
          const token = part.trim().toLowerCase();
          if (token === 'mod') return IS_APPLE ? '⌘' : 'Ctrl';
          if (token === 'alt') return IS_APPLE ? '⌥' : 'Alt';
          if (token === 'shift') return '⇧';
          if (token === '?') return '?';
          return KEY_LABELS[token] ?? (token.length === 1 ? token.toUpperCase() : token);
        })
        .join(''),
    );
}

/* ------------------------------------------------------------------ */
/* The hook                                                           */
/* ------------------------------------------------------------------ */

export function useKeyboard(bindings: readonly KeyBinding[], options: Options = {}): void {
  const { enabled = true, sequenceTimeoutMs = 1200 } = options;

  // Keep the latest bindings without re-attaching the listener on every render.
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const parsed = useMemo(
    () => bindings.map((binding) => ({ binding, steps: parseBinding(binding.keys) })),
    [bindings],
  );
  const parsedRef = useRef(parsed);
  parsedRef.current = parsed;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let pending: { steps: ParsedStep[]; expiresAt: number } | null = null;

    const onKeyDown = (event: KeyboardEvent): void => {
      const actual = eventStep(event);
      if (actual === null) return;

      const editable = isEditableTarget(event.target);

      if (pending && Date.now() > pending.expiresAt) pending = null;

      const candidates = parsedRef.current.filter(({ binding }) => {
        if (editable && binding.allowInInput !== true) return false;
        if (event.repeat && binding.allowRepeat !== true) return false;
        if (binding.when && !binding.when()) return false;
        return true;
      });

      // Continue an in-flight sequence first.
      if (pending) {
        const nextStep = pending.steps[1];
        if (nextStep && stepMatches(nextStep, actual)) {
          const binding = candidates.find(
            ({ steps }) => steps.length === 2 && stepMatches(steps[1] ?? nextStep, actual),
          );
          pending = null;
          if (binding) {
            event.preventDefault();
            binding.binding.handler(event);
          }
          return;
        }
        pending = null;
      }

      for (const { binding, steps } of candidates) {
        const first = steps[0];
        if (!first || !stepMatches(first, actual)) continue;

        if (steps.length === 1) {
          event.preventDefault();
          binding.handler(event);
          return;
        }

        // Multi-step binding: arm the sequence and wait for the next key.
        pending = { steps, expiresAt: Date.now() + sequenceTimeoutMs };
        event.preventDefault();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, sequenceTimeoutMs]);
}

/* ------------------------------------------------------------------ */
/* Declarative map for the help overlay (Plan §15.4)                   */
/* ------------------------------------------------------------------ */

export interface KeymapEntry {
  keys: string;
  description: string;
  group: KeyboardGroup;
}

export const KEYBOARD_MAP: readonly KeymapEntry[] = [
  { keys: 'mod+k', description: 'Open command palette', group: 'Global' },
  { keys: '?', description: 'Keyboard shortcuts', group: 'Global' },
  { keys: '/', description: 'Focus search', group: 'Global' },
  { keys: 'escape', description: 'Close / cancel', group: 'Global' },
  { keys: 'mod+enter', description: 'Submit form', group: 'Global' },
  { keys: 'mod+s', description: 'Save inline edit', group: 'Global' },
  { keys: 'g p', description: 'Go to Policies', group: 'Navigation' },
  { keys: 'g n', description: 'Go to Principals', group: 'Navigation' },
  { keys: 'g r', description: 'Go to Resources', group: 'Navigation' },
  { keys: 'g s', description: 'Go to Scenarios', group: 'Navigation' },
  { keys: 'g e', description: 'Go to Evaluate', group: 'Navigation' },
  { keys: 'g i', description: 'Go to Impact', group: 'Navigation' },
  { keys: 'g g', description: 'Go to Graph', group: 'Navigation' },
  { keys: 'g t', description: 'Go to Timeline', group: 'Navigation' },
  { keys: 'g a', description: 'Go to Audit log', group: 'Navigation' },
  { keys: 'c', description: 'Create (context aware)', group: 'Create' },
  { keys: 'e', description: 'Evaluate selected', group: 'Actions' },
  { keys: 'f', description: 'Zoom to fit', group: 'Graph' },
  { keys: 'r', description: 'Reset view', group: 'Graph' },
  { keys: 'arrowleft', description: 'Previous event', group: 'Timeline' },
  { keys: 'arrowright', description: 'Next event', group: 'Timeline' },
  { keys: 'shift+arrowleft', description: 'Previous day', group: 'Timeline' },
  { keys: 'shift+arrowright', description: 'Next day', group: 'Timeline' },
  { keys: 'home', description: 'Jump to org creation', group: 'Timeline' },
  { keys: 'end', description: 'Jump to now', group: 'Timeline' },
];

export function groupKeymap(entries: readonly KeymapEntry[] = KEYBOARD_MAP): {
  group: KeyboardGroup;
  entries: KeymapEntry[];
}[] {
  const order: KeyboardGroup[] = ['Global', 'Navigation', 'Create', 'Actions', 'Graph', 'Timeline'];
  return order
    .map((group) => ({ group, entries: entries.filter((entry) => entry.group === group) }))
    .filter((section) => section.entries.length > 0);
}
