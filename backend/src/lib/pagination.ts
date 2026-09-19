import type { Paginated, SortQuery } from '@iamscope/types';

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export interface PaginationArgs {
  page: number;
  pageSize: number;
  skip: number;
  limit: number;
}

export interface PaginationQueryLike {
  page?: number | undefined;
  pageSize?: number | undefined;
}

export function resolvePagination(query: PaginationQueryLike): PaginationArgs {
  const rawPage = query.page ?? DEFAULT_PAGE;
  const rawSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : DEFAULT_PAGE;
  const pageSize = Number.isFinite(rawSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(rawSize)))
    : DEFAULT_PAGE_SIZE;
  return { page, pageSize, skip: (page - 1) * pageSize, limit: pageSize };
}

export function paginated<T>(items: T[], total: number, args: PaginationArgs): Paginated<T> {
  return {
    items,
    total,
    page: args.page,
    pageSize: args.pageSize,
    hasMore: args.skip + items.length < total,
  };
}

/** Resolves `?sort=` against an allow-list so a client can never sort on `$where`. */
export function resolveSort<T extends string>(
  query: SortQuery,
  allowed: readonly T[],
  fallback: T,
  fallbackOrder: 'asc' | 'desc' = 'desc',
): { field: T; direction: 1 | -1 } {
  const requested = query.sort;
  const field =
    requested !== undefined && (allowed as readonly string[]).includes(requested)
      ? (requested as T)
      : fallback;
  const order = query.order ?? fallbackOrder;
  return { field, direction: order === 'asc' ? 1 : -1 };
}

/** Mongo sort spec `[field, direction]` pairs preserve key order (unlike object literals typed loosely). */
export function sortSpec(pairs: [string, 1 | -1][]): [string, 1 | -1][] {
  return pairs;
}
