/**
 * In-Mongo rate limiting with TTL expiry (Plan §9.4). No Redis.
 *
 * Counters are keyed by a *time bucket* so a new window starts atomically without any
 * read-modify-write dance: `key = "<name>:<identifier>:<bucketStartMs>"`.
 */
import type { Request, RequestHandler } from 'express';
import { identity } from '../db/identity';
import { AppError } from '../lib/errors';
import { logger } from '../logger';
import { recordAuthEvent } from '../services/audit';

export interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_RULES = {
  loginPerEmail: { name: 'login-email', limit: 5, windowMs: 15 * 60_000 },
  loginPerIp: { name: 'login-ip', limit: 20, windowMs: 15 * 60_000 },
  signupPerIp: { name: 'signup-ip', limit: 3, windowMs: 60 * 60_000 },
  passwordResetPerEmail: { name: 'pwreset-email', limit: 3, windowMs: 60 * 60_000 },
  apiPerKey: { name: 'api-key', limit: 600, windowMs: 60_000 },
  apiPerSession: { name: 'api-session', limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: Date;
}

export function clientIp(req: Request): string {
  if (typeof req.ip === 'string' && req.ip.trim() !== '') return req.ip;

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    const addresses = forwarded.split(',');
    for (let i = addresses.length - 1; i >= 0; i -= 1) {
      const address = addresses[i]?.trim();
      if (address) return address;
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Increments the counter for `key` and reports whether the caller is still inside the limit.
 * Fails open: a Mongo hiccup must never take the API down.
 */
export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const bucketStart = Math.floor(now.getTime() / rule.windowMs) * rule.windowMs;
  const windowStart = new Date(bucketStart);
  const expiresAt = new Date(bucketStart + rule.windowMs);
  const bucketKey = `${rule.name}:${key}:${bucketStart}`;

  try {
    const updated = await identity
      .rateLimits()
      .findOneAndUpdate(
        { key: bucketKey },
        { $inc: { count: 1 }, $setOnInsert: { windowStart, expiresAt } },
        { upsert: true, returnDocument: 'after', projection: { count: 1 } },
      );

    const count = updated?.count ?? 1;
    const remaining = Math.max(0, rule.limit - count);

    return {
      allowed: count <= rule.limit,
      count,
      limit: rule.limit,
      remaining,
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000)),
      resetAt: expiresAt,
    };
  } catch (error) {
    logger.warn({ err: error, rule: rule.name }, 'rate limit counter failed - failing open');
    return {
      allowed: true,
      count: 0,
      limit: rule.limit,
      remaining: rule.limit,
      retryAfterSeconds: 0,
      resetAt: new Date(now.getTime() + rule.windowMs),
    };
  }
}

export async function enforceRateLimit(
  req: Request,
  key: string,
  rule: RateLimitRule,
  authEvent: { userId?: string | null; email?: string | null; orgId?: string | null } = {},
): Promise<RateLimitResult> {
  const result = await consumeRateLimit(key, rule);
  if (result.allowed) return result;

  void recordAuthEvent({
    type: 'rate.limited',
    ip: clientIp(req),
    userAgent: req.headers['user-agent'] ?? '',
    email: authEvent.email ?? null,
    metadata: { rule: rule.name, limit: rule.limit, windowMs: rule.windowMs },
  });

  const error = new AppError('RATE_LIMITED', 'Too many requests - please slow down');
  throw Object.assign(error, { retryAfterSeconds: result.retryAfterSeconds });
}

/** Builds a middleware for a static rule keyed by a request-derived identifier. */
export function rateLimit(rule: RateLimitRule, keyOf: (req: Request) => string): RequestHandler {
  return (req, res, next) => {
    enforceRateLimit(req, keyOf(req), rule)
      .then((result) => {
        res.setHeader('X-RateLimit-Limit', String(result.limit));
        res.setHeader('X-RateLimit-Remaining', String(result.remaining));
        next();
      })
      .catch((error: unknown) => {
        const retryAfter = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
        if (typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
        next(error);
      });
  };
}

export function signupRateLimit(): RequestHandler {
  return rateLimit(RATE_LIMIT_RULES.signupPerIp, (req) => clientIp(req));
}

/** Applied to every authenticated API request - 600/min per key, 120/min per session. */
export function apiRateLimit(): RequestHandler {
  return (req, res, next) => {
    const auth = req.auth;
    if (auth === undefined) {
      next();
      return;
    }

    const rule =
      auth.actorType === 'api_key' ? RATE_LIMIT_RULES.apiPerKey : RATE_LIMIT_RULES.apiPerSession;
    const key =
      auth.actorType === 'api_key' && auth.apiKey !== null
        ? `key:${auth.apiKey._id.toHexString()}`
        : `session:${auth.session === null ? 'none' : auth.session._id.toHexString()}`;

    enforceRateLimit(req, key, rule)
      .then((result) => {
        res.setHeader('X-RateLimit-Limit', String(result.limit));
        res.setHeader('X-RateLimit-Remaining', String(result.remaining));
        next();
      })
      .catch((error: unknown) => {
        const retryAfter = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
        if (typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
        next(error);
      });
  };
}
