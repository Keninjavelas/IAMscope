/**
 * Shared plumbing for optimistic mutations (Plan §3.9, §17).
 *
 * Every hook in this folder follows the same shape:
 *   onMutate  -> cancel, snapshot, write the optimistic value
 *   onError   -> restore the snapshot + raise a toast
 *   onSettled -> invalidate the affected keys so SSE and truth converge
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { Paginated } from '@iamscope/types';
import { ApiError } from '@/api/client';

/** A mutation fired before an org is active is a programming error, not a network one. */
export function noOrgError(): ApiError {
  return new ApiError({
    code: 'BAD_REQUEST',
    message: 'Select an organization first',
    status: 400,
  });
}

export type Snapshot = [QueryKey, unknown][];

export function takeSnapshot(queryClient: QueryClient, filters: { queryKey: QueryKey }): Snapshot {
  return queryClient.getQueriesData(filters);
}

export function restoreSnapshot(queryClient: QueryClient, snapshot: Snapshot | undefined): void {
  if (!snapshot) return;
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}

/**
 * Apply `patch` to every `Paginated<T>` cached under a key prefix.
 * Returning `null` from `patch` removes the row and decrements `total`, which is
 * what a delete looks like before the server confirms it.
 */
export function patchPages<T extends { id: string }>(
  old: unknown,
  patch: (item: T) => T | null,
): unknown {
  if (old === null || typeof old !== 'object') return old;
  const page = old as Partial<Paginated<T>>;
  if (!Array.isArray(page.items)) return old;

  const items: T[] = [];
  let removed = 0;
  for (const item of page.items) {
    const next = patch(item);
    if (next === null) removed += 1;
    else items.push(next);
  }

  const total = typeof page.total === 'number' ? Math.max(0, page.total - removed) : items.length;
  return { ...page, items, total };
}

/**
 * Remove one row from every cached page.
 *
 * Not generic: the row type never escapes (`patchPages` only needs `id`), so a type
 * parameter would be an unused knob on every call site.
 */
export function removeFromPages(old: unknown, id: string): unknown {
  return patchPages<{ id: string }>(old, (item) => (item.id === id ? null : item));
}
