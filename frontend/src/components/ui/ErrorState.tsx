import type { ReactNode, JSX } from 'react';
import { RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { isApiError } from '@/api/client';
import { Button } from './Button';
import { cn } from '@/lib/cn';

export interface ErrorStateProps {
  error: unknown;
  title?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** Extra actions rendered next to Retry. */
  action?: ReactNode | undefined;
  className?: string | undefined;
  compact?: boolean | undefined;
}

interface ErrorPresentation {
  title: string;
  message: string;
  code: string | null;
  requestId: string | null;
  retryable: boolean;
}

/** Turn anything thrown at us into something a human can act on (Plan §18). */
export function describeUnknownError(error: unknown): ErrorPresentation {
  if (isApiError(error)) {
    const retryable = !(error.isForbidden || error.isNotFound);
    return {
      title: error.isForbidden
        ? 'You do not have access'
        : error.isNotFound
          ? 'Not found'
          : error.isRateLimited
            ? 'Slow down'
            : error.isUnauthenticated
              ? 'Session expired'
              : 'Something went wrong',
      message: error.message,
      code: String(error.code),
      requestId: error.requestId,
      retryable,
    };
  }

  if (error instanceof TypeError) {
    return {
      title: 'Cannot reach the API',
      message: error.message || 'The request could not be sent. Check your connection and retry.',
      code: 'NETWORK_ERROR',
      requestId: null,
      retryable: true,
    };
  }

  if (error instanceof Error) {
    return {
      title: 'Something went wrong',
      message: error.message,
      code: null,
      requestId: null,
      retryable: true,
    };
  }

  return {
    title: 'Something went wrong',
    message: typeof error === 'string' ? error : 'An unexpected error occurred.',
    code: null,
    requestId: null,
    retryable: true,
  };
}

export function ErrorState({
  error,
  title,
  onRetry,
  action,
  className,
  compact = false,
}: ErrorStateProps): JSX.Element {
  const described = describeUnknownError(error);
  const headline = title ?? described.title;
  const Icon = described.code === 'NETWORK_ERROR' ? WifiOff : ShieldAlert;
  const canRetry = described.retryable && onRetry !== undefined;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'px-4 py-6' : 'px-6 py-12',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-panel border border-danger/40 bg-danger-subtle text-danger"
      >
        <Icon className="size-4" />
      </span>

      <p className="text-14 font-medium text-text">{headline}</p>
      <p className="text-meta max-w-prose text-text-muted">{described.message}</p>

      {described.code || described.requestId ? (
        <dl className="text-micro mono flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-text-subtle">
          {described.code ? (
            <div className="flex items-center gap-1">
              <dt className="text-text-subtle">code</dt>
              <dd className="tabular">{described.code}</dd>
            </div>
          ) : null}
          {described.requestId ? (
            <div className="flex items-center gap-1">
              <dt className="text-text-subtle">request</dt>
              <dd className="tabular">{described.requestId}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {canRetry || action ? (
        <div className="mt-1 flex items-center gap-2">
          {canRetry ? (
            <Button size="sm" variant="secondary" iconLeft={RefreshCw} onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
