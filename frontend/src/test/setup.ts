/*
 * jsdom is missing a handful of browser APIs the design system touches.
 *
 * Two rules are disabled for this file only, and both are wrong here by construction:
 *
 * - `no-unnecessary-condition`: the `if (!window.matchMedia)` guards look always-falsy
 *   because TypeScript's DOM lib declares every one of these members unconditionally.
 *   The guards exist precisely because the *runtime* may not have them - which jsdom
 *   version is installed is not something the type system knows.
 * - `no-empty-function`: `observe` / `unobserve` / `disconnect` are deliberate no-ops.
 *   That is the entire point of a stub.
 */
/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unnecessary-condition */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  };
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false;
  };
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {};
}

if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {};
}

beforeEach(() => {
  // Each test starts from a clean ui preference store.
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-accent');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
