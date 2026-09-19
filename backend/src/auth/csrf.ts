/**
 * Double-submit CSRF protection (Plan §9.3, §19).
 *
 * The cookie is readable by the frontend; the frontend echoes it back in `X-CSRF-Token`.
 * Verification is skipped for safe methods and for the pre-session auth routes.
 */
import type { Request, Response } from 'express';
import { csrfFailed } from '../lib/errors';
import { timingSafeEqualString } from './tokens';
import { setCsrfCookie, clearCsrfCookie, readCsrfCookie, readCsrfHeader } from './cookies';
import { randomToken } from './tokens';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Paths reachable before a session exists (relative to the `/api` mount point). */
const PRE_SESSION_PATHS: readonly { method: string; pattern: RegExp }[] = [
  { method: 'POST', pattern: /^\/auth\/signup\/?$/ },
  { method: 'POST', pattern: /^\/auth\/login\/?$/ },
  { method: 'POST', pattern: /^\/auth\/forgot-password\/?$/ },
  { method: 'POST', pattern: /^\/auth\/reset-password\/?$/ },
  { method: 'POST', pattern: /^\/auth\/verify-email\/?$/ },
  { method: 'POST', pattern: /^\/invitations\/[^/]+\/accept\/?$/ },
];

/** Returns the `/api`-relative path for a request. */
export function apiRelativePath(req: Request): string {
  const original = req.originalUrl.split('?')[0] ?? req.path;
  const withoutApi = original.startsWith('/api') ? original.slice(4) : original;
  return withoutApi === '' ? '/' : withoutApi;
}

export function shouldSkipCsrf(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return true;
  const path = apiRelativePath(req);
  return PRE_SESSION_PATHS.some((entry) => entry.method === method && entry.pattern.test(path));
}

/** Issues (or re-issues) the CSRF cookie. Called on session create/rotate. */
export function issueCsrfToken(res: Response): string {
  const token = randomToken(24);
  setCsrfCookie(res, token);
  return token;
}

export function clearCsrfToken(res: Response): void {
  clearCsrfCookie(res);
}

/**
 * Throws `CSRF_FAILED` (403) when the header does not match the cookie.
 * Called by the global CSRF middleware for every non-safe request.
 */
export function verifyCsrf(req: Request): void {
  const cookie = readCsrfCookie(req);
  const header = readCsrfHeader(req);

  if (cookie === undefined || header === undefined) throw csrfFailed();
  if (!timingSafeEqualString(cookie, header)) throw csrfFailed();
}

/** Pure predicate used by the middleware + unit tests. */
export function csrfMatches(cookie: string | undefined, header: string | undefined): boolean {
  if (cookie === undefined || header === undefined) return false;
  return timingSafeEqualString(cookie, header);
}
