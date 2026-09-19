/// <reference types="vite/client" />

/**
 * Typed frontend environment (Plan §23). Only `VITE_*` variables are exposed to
 * the bundle; anything else must go through `src/env.ts` validation.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /**
   * Declared so the two SSE variables are typed rather than falling through to Vite's
   * `any` index signature - an untyped key here is an `no-unsafe-assignment` error in
   * `src/env.ts`, not a silent convenience.
   */
  readonly VITE_SSE_MODE?: 'cookie' | 'token';
  readonly VITE_RENDER_URL?: string;
  readonly MODE: 'development' | 'production' | 'test';
  readonly DEV: boolean;
  readonly PROD: boolean;
}
