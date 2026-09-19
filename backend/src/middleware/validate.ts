/**
 * zod validation middleware (Plan §5.1, §18). Parsed output replaces the raw input so route
 * handlers only ever see coerced, trimmed, defaulted values.
 */
import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../lib/errors';
import { formatZodIssues } from './errorHandler';

function validationFailure(error: unknown): AppError {
  const issues =
    typeof error === 'object' && error !== null && 'issues' in error
      ? formatZodIssues(error as Parameters<typeof formatZodIssues>[0])
      : [];
  return new AppError('VALIDATION_ERROR', 'Request validation failed', 400, issues);
}

/** Express 4 exposes `req.query` as a getter in newer releases - assign defensively. */
function assignQuery(target: object, value: unknown): void {
  try {
    Object.defineProperty(target, 'query', {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    (target as { query?: unknown }).query = value;
  }
}

export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      next(validationFailure(result.error));
      return;
    }
    req.body = result.data as unknown;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    // Express 4 types `req.query` as non-nullable `ParsedQs`, so `?? {}` was dead code.
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(validationFailure(result.error));
      return;
    }
    assignQuery(req, result.data as unknown);
    next();
  };
}

export function validateParams(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(validationFailure(result.error));
      return;
    }
    req.params = result.data as typeof req.params;
    next();
  };
}

/**
 * `orgId` always comes from the session or API key (Plan §3.4). Domain routes therefore reject
 * any attempt to smuggle a tenant override through the body or the query string.
 */
export function rejectPayloadOrgId(): RequestHandler {
  return (req, _res, next) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (body !== undefined && typeof body === 'object' && 'orgId' in body) {
      next(
        new AppError(
          'BAD_REQUEST',
          'orgId is derived from your session and must not be sent in the body',
        ),
      );
      return;
    }
    const query = req.query as Record<string, unknown> | undefined;
    if (query !== undefined && Object.prototype.hasOwnProperty.call(query, 'orgId')) {
      next(
        new AppError(
          'BAD_REQUEST',
          'orgId is derived from your session and must not be sent in the query string',
        ),
      );
      return;
    }
    next();
  };
}
