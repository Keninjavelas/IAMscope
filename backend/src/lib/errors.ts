/**
 * Typed application errors. Every error that reaches `errorHandler` is normalised into
 * the `{ data: null, error: { code, message, details?, requestId } }` envelope (Plan §18).
 */
import type { ApiErrorCode } from '@iamscope/types';

const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CSRF_FAILED: 403,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export class AppError extends Error {
  readonly code: ApiErrorCode;

  /** HTTP status. */
  readonly status: number;

  /** Extra machine-readable context. Serialised into the response envelope. */
  readonly details: unknown;

  /** When false the message is replaced with a generic one before it leaves the process. */
  readonly expose: boolean;

  constructor(code: ApiErrorCode, message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? DEFAULT_STATUS[code];
    this.details = details === undefined ? null : details;
    this.expose = true;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError('BAD_REQUEST', message, undefined, details);
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError('VALIDATION_ERROR', message, undefined, details);
}

export function unauthenticated(message = 'Authentication required'): AppError {
  return new AppError('UNAUTHENTICATED', message);
}

export function forbidden(message = 'You do not have permission to perform this action'): AppError {
  return new AppError('FORBIDDEN', message);
}

export function notFound(message = 'Resource not found'): AppError {
  return new AppError('NOT_FOUND', message);
}

export function conflict(message: string, details?: unknown): AppError {
  return new AppError('CONFLICT', message, undefined, details);
}

export function rateLimited(message = 'Too many requests', details?: unknown): AppError {
  return new AppError('RATE_LIMITED', message, undefined, details);
}

export function csrfFailed(message = 'CSRF token missing or invalid'): AppError {
  return new AppError('CSRF_FAILED', message);
}

export function payloadTooLarge(message = 'Request payload is too large'): AppError {
  return new AppError('PAYLOAD_TOO_LARGE', message);
}

export function internalError(message = 'Internal server error'): AppError {
  const error = new AppError('INTERNAL_ERROR', message);
  return error;
}

export function serviceUnavailable(message = 'Service temporarily unavailable'): AppError {
  return new AppError('SERVICE_UNAVAILABLE', message);
}

/** True when the value is a Mongo duplicate-key violation (E11000). */
export function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 11000 || code === 11001;
}

/**
 * Transactions are unsupported on standalone mongod. The driver surfaces this either as
 * code 20 or as a message mentioning `$changeStream`/`Transaction numbers`.
 */
export function isTransactionUnsupported(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 20 || code === 251) return true;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  return (
    message.includes('Transaction numbers are only allowed') ||
    message.includes('transactions are not supported') ||
    message.includes('This MongoDB deployment does not support retryable writes')
  );
}

/** Change streams need a replica set / sharded cluster. */
export function isChangeStreamUnsupported(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const codeName = (error as { codeName?: unknown }).codeName;
  if (code === 40573 || code === 20 || codeName === 'Location40573') return true;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  return (
    message.includes('$changeStream') ||
    message.includes('ChangeStreamNotSupported') ||
    message.includes('only supported on replica sets') ||
    message.includes('not support change streams')
  );
}
