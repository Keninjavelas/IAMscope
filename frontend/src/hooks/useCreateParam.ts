import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface CreateParamResult<T extends string> {
  /** The `?new=<kind>` value when it is one of the kinds this page owns. */
  requested: T | null;
  /** Removes `?new=` without touching the other filter params. */
  clear: () => void;
}

/**
 * List pages open their create dialog from `?new=<kind>` so the global `c`
 * shortcut and the command palette can deep-link into a form without any
 * cross-component state (Plan §17: URL is state).
 */
export function useCreateParam<T extends string>(kinds: readonly T[]): CreateParamResult<T> {
  const [params, setParams] = useSearchParams();
  const raw = params.get('new');
  const requested = raw !== null && (kinds as readonly string[]).includes(raw) ? (raw as T) : null;

  const clear = useCallback(() => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  return { requested, clear };
}
