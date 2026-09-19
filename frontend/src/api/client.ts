import type { ApiErrorBody, ApiErrorCode, ApiResponse } from '@iamscope/types';
import { env } from '@/env';

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  readonly code: ApiErrorCode | (string & {});
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(params: {
    code: ApiErrorCode | (string & {});
    message: string;
    status: number;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
    this.requestId = params.requestId ?? null;
  }

  get isUnauthenticated(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.status === 401;
  }

  get isForbidden(): boolean {
    return this.code === 'FORBIDDEN' || this.status === 403;
  }

  get isNotFound(): boolean {
    return this.code === 'NOT_FOUND' || this.status === 404;
  }

  get isConflict(): boolean {
    return this.code === 'CONFLICT' || this.status === 409;
  }

  get isRateLimited(): boolean {
    return this.code === 'RATE_LIMITED' || this.status === 429;
  }

  /** `details` from a zod failure is a list of `{ path, message }` issues. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (!Array.isArray(this.details)) return out;
    for (const issue of this.details) {
      if (typeof issue !== 'object' || issue === null) continue;
      const record = issue as { path?: unknown; message?: unknown };
      const rawPath = record.path;
      const key = Array.isArray(rawPath)
        ? rawPath.join('.')
        : typeof rawPath === 'string' || typeof rawPath === 'number'
          ? String(rawPath)
          : '';
      if (key && typeof record.message === 'string') out[key] = record.message;
    }
    return out;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/* ------------------------------------------------------------------ */
/* URL building                                                       */
/* ------------------------------------------------------------------ */

export type QueryValue =
  string | number | boolean | null | undefined | readonly (string | number | boolean)[];

export function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const entry of value) search.append(key, String(entry));
    } else {
      search.append(key, String(value));
    }
  }
  const serialised = search.toString();
  return serialised ? `?${serialised}` : '';
}

/** `'/policies'` -> `'/api/policies'` (or `<origin>/api/policies`). */
function toUrl(path: string, query?: Record<string, QueryValue>): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  const withApi = normalised.startsWith('/api/') ? normalised : `/api${normalised}`;
  return `${env.apiBaseUrl}${withApi}${buildQuery(query)}`;
}

/** Absolute URL for the SSE endpoint on the same origin/auth context. */
export function eventsUrl(): string {
  return toUrl('/events');
}

/**
 * Absolute URL for the SSE endpoint when authenticating with an event token instead of the
 * session cookie (Fallback B).
 *
 * The token travels as a query parameter because `EventSource` can neither set headers nor
 * send a body - the consequence for log exposure is recorded in DECISIONS D24. Built here,
 * beside `eventsUrl`, so URL construction stays in one module.
 */
export function tokenEventsUrl(token: string): string {
  return `${env.renderBaseUrl}/api/events?token=${encodeURIComponent(token)}`;
}

/** Absolute URL for the CSRF bootstrap endpoint. */
export function csrfUrl(): string {
  return toUrl('/auth/csrf');
}

/* ------------------------------------------------------------------ */
/* CSRF (double submit, Plan §9.3)                                    */
/* ------------------------------------------------------------------ */

export const CSRF_COOKIE = 'iamscope_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      return decodeURIComponent(trimmed.slice(target.length));
    }
  }
  return null;
}

let csrfInFlight: Promise<string | null> | null = null;

/**
 * Guarantees a CSRF cookie exists. Called before any mutating request so the
 * header can be echoed back. On a fresh browser with no session yet the server
 * issues one on demand from `GET /api/auth/csrf`.
 */
export async function ensureCsrfToken(force = false): Promise<string | null> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing && !force) return existing;

  csrfInFlight ??= (async () => {
    try {
      await fetch(csrfUrl(), {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch {
      return null;
    } finally {
      // Allow a retry on the next mutation if this round produced nothing.
      queueMicrotask(() => {
        csrfInFlight = null;
      });
    }
    return readCookie(CSRF_COOKIE);
  })();

  return csrfInFlight;
}

/* ------------------------------------------------------------------ */
/* Core request                                                       */
/* ------------------------------------------------------------------ */

export interface RequestOptions {
  /** Skip the automatic `X-CSRF-Token` header (used by the CSRF bootstrap). */
  skipCsrf?: boolean;
  /** Abort signal for cancellable queries. */
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    return text === '' ? null : { message: text };
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Raw call - returns the full `{ data, error }` envelope plus the status. */
export async function rawRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, QueryValue>,
  options: RequestOptions = {},
): Promise<{ status: number; envelope: ApiResponse<T> | null; requestId: string | null }> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!SAFE_METHODS.has(method) && options.skipCsrf !== true) {
    const token = await ensureCsrfToken().catch(() => null);
    if (token) headers[CSRF_HEADER] = token;
  }

  const response = await fetch(toUrl(path, query), {
    method,
    credentials: 'include',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const requestId = response.headers.get('x-request-id');
  const payload = await parseBody(response);
  const envelope =
    payload !== null &&
    typeof payload === 'object' &&
    'data' in (payload as Record<string, unknown>)
      ? (payload as ApiResponse<T>)
      : ({ data: (payload as T | null) ?? null } satisfies ApiResponse<T>);

  return { status: response.status, envelope, requestId };
}

function toApiError(
  status: number,
  envelope: ApiResponse<unknown>,
  requestId: string | null,
): ApiError {
  const body: ApiErrorBody | undefined = envelope.error;

  if (body) {
    return new ApiError({
      code: body.code,
      message: body.message,
      status,
      details: body.details,
      requestId: body.requestId ?? requestId,
    });
  }

  return new ApiError({
    code: status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR',
    message: `Request failed with status ${status}`,
    status,
    requestId,
  });
}

/** Standard call - unwraps `data`, throws `ApiError` on any failure. */
export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, QueryValue>,
  options: RequestOptions = {},
): Promise<T> {
  const { status, envelope, requestId } = await rawRequest<T>(method, path, body, query, options);

  if (envelope === null || status < 200 || status >= 300 || envelope.error) {
    throw toApiError(status, envelope ?? { data: null }, requestId);
  }

  // `ApiResponse<T>.data` is `T | null`, so returning `envelope.data as T` used to be
  // the one place the client lied about its own contract. That lie is what made every
  // `result?.field` downstream look redundant to the type checker while still being a
  // genuine runtime hazard. Enforce it here instead: every route on this API answers
  // through `sendData` and there are no 204s (Plan 8), so a successful response without
  // a body is a malformed response, not an empty one.
  if (envelope.data === null || envelope.data === undefined) {
    throw new ApiError({
      code: 'EMPTY_RESPONSE',
      message: `Successful response from ${method} ${path} carried no data`,
      status,
      requestId,
    });
  }

  return envelope.data;
}

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>, options?: RequestOptions) =>
    apiRequest<T>('GET', path, undefined, query, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('POST', path, body ?? {}, undefined, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('PUT', path, body ?? {}, undefined, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('PATCH', path, body ?? {}, undefined, options),
  delete: <T>(path: string, query?: Record<string, QueryValue>, options?: RequestOptions) =>
    apiRequest<T>('DELETE', path, undefined, query, options),
} as const;

/** Exposed for tests - lets a suite point the client at a stub server. */
export const internals = { toUrl, toApiError, parseBody };
