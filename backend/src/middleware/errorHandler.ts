/**
 * Error normalisation (Plan §18). Every failure leaves the process as
 * `{ data: null, error: { code, message, details?, requestId } }`.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MongoNetworkError, MongoServerSelectionError, MongoNetworkTimeoutError } from 'mongodb';
import { ZodError } from 'zod';
import type { ApiErrorBody, ApiResponse } from '@iamscope/types';
import { AppError, badRequest, conflict, isDuplicateKeyError } from '../lib/errors';
import { logger } from '../logger';

export interface ZodIssueSummary {
  path: string;
  message: string;
  code: string;
}

export function formatZodIssues(error: ZodError): ZodIssueSummary[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Wraps a handler so rejections reach `errorHandler` (Express 4 does not do this).
 *
 * Accepts a plain `unknown` return rather than `Promise<unknown>`: several handlers
 * (the CSRF bootstrap, the API-key scope guard) are genuinely synchronous, and forcing
 * them to be `async` to satisfy the signature is what `require-await` complains about.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function sendData(res: Response, data: unknown, status = 200): void {
  const body: ApiResponse<unknown> = { data };
  res.status(status).json(body);
}

export function sendError(res: Response, error: AppError, requestId: string): void {
  const body: ApiResponse<never> = {
    data: null,
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.details === null || error.details === undefined ? {} : { details: error.details }),
    } satisfies ApiErrorBody,
  };
  res.status(error.status).json(body);
}

interface BodyParserError {
  type?: unknown;
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
}

function asBodyParserError(error: unknown): BodyParserError | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as BodyParserError;
  if (typeof candidate.type === 'string' || typeof candidate.statusCode === 'number')
    return candidate;
  return null;
}

function normalise(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new AppError(
      'VALIDATION_ERROR',
      'Request validation failed',
      400,
      formatZodIssues(error),
    );
  }

  const parserError = asBodyParserError(error);
  if (parserError !== null) {
    if (parserError.type === 'entity.too.large') {
      return new AppError('PAYLOAD_TOO_LARGE', 'Request payload is too large');
    }
    if (parserError.type === 'entity.parse.failed') {
      return badRequest('Malformed JSON body');
    }
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return badRequest('Malformed JSON body');
  }

  if (isDuplicateKeyError(error)) {
    return conflict('A record with that value already exists');
  }

  if (
    error instanceof MongoNetworkError ||
    error instanceof MongoServerSelectionError ||
    error instanceof MongoNetworkTimeoutError
  ) {
    return new AppError(
      'SERVICE_UNAVAILABLE',
      'Database temporarily unavailable - please retry shortly',
      503,
    );
  }

  return new AppError('INTERNAL_ERROR', 'Internal server error');
}

export function notFoundHandler(req: Request, res: Response): void {
  const requestId = typeof req.requestId === 'string' ? req.requestId : 'unknown';
  sendError(
    res,
    new AppError('NOT_FOUND', `No route matches ${req.method} ${req.path}`),
    requestId,
  );
}

/** Express error middleware - must keep all four parameters. */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = typeof req.requestId === 'string' ? req.requestId : 'unknown';
  const appError = normalise(error);

  if (res.headersSent) {
    logger.error({ err: error, requestId }, 'error after headers were sent');
    res.end();
    return;
  }

  if (appError.status >= 500) {
    logger.error(
      { err: error, requestId, code: appError.code, path: req.originalUrl, method: req.method },
      'request failed',
    );
  } else {
    logger.warn(
      { requestId, code: appError.code, path: req.originalUrl, method: req.method },
      appError.message,
    );
  }

  // 5xx never leaks internals: `normalise` already replaced the message.
  sendError(res, appError, requestId);
}
