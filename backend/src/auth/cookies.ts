/**
 * Cookie set/clear/parse helpers (Plan §9.2, §9.3).
 *
 * - `iamscope_session`  httpOnly, secure in production, sameSite from env, path `/`, 30 days.
 * - `iamscope_csrf`     NOT httpOnly (the frontend must read it to echo the header).
 */
import { parse } from 'cookie';
import type { Request, Response } from 'express';
import { COOKIE_SECURE, SESSION_TTL_MS, env } from '../env';

export const SESSION_COOKIE = 'iamscope_session';
export const CSRF_COOKIE = 'iamscope_csrf';
export const CSRF_HEADER = 'x-csrf-token';

interface CookieBase {
  path: string;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
}

function cookieBase(): CookieBase {
  return { path: '/', sameSite: env.COOKIE_SAMESITE, secure: COOKIE_SECURE };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    ...cookieBase(),
    httpOnly: true,
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieBase());
}

/** Non-httpOnly so `document.cookie` can read it - that is the whole point of double-submit. */
export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    ...cookieBase(),
    httpOnly: false,
    maxAge: SESSION_TTL_MS,
  });
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE, cookieBase());
}

/** Raw `Cookie` header parse, used when `cookie-parser` has not run. */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (header === undefined || header === '') return {};
  const parsed = parse(header);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/** Reads a single cookie, preferring `cookie-parser`'s `req.cookies`. */
export function readCookie(req: Request, name: string): string | undefined {
  const parsed = req.cookies as Record<string, unknown> | undefined;
  const fromParser = parsed?.[name];
  if (typeof fromParser === 'string' && fromParser !== '') return fromParser;

  const fromHeader = parseCookies(req.headers.cookie)[name];
  return fromHeader === undefined || fromHeader === '' ? undefined : fromHeader;
}

export function readSessionToken(req: Request): string | undefined {
  return readCookie(req, SESSION_COOKIE);
}

export function readCsrfCookie(req: Request): string | undefined {
  return readCookie(req, CSRF_COOKIE);
}

export function readCsrfHeader(req: Request): string | undefined {
  const value = req.headers[CSRF_HEADER];
  if (typeof value === 'string' && value !== '') return value;
  return undefined;
}

/** Bearer tokens take precedence over cookies for API-key auth (Plan §8.14). */
export function readBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const [scheme, value] = header.split(' ');
  if (scheme === undefined || value === undefined) return undefined;
  if (scheme.toLowerCase() !== 'bearer') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
