import type { Document, Filter, ObjectId } from 'mongodb';
import { escapeRegExp } from './wildcard';

export { escapeRegExp };

/** Case-insensitive, regex-escaped search used by every `?q=` filter. */
export function buildSearchRegex(q: string): RegExp {
  return new RegExp(escapeRegExp(q.trim()), 'i');
}

/** Always prefixes a filter with the tenant boundary (Plan §9.6). */
export function orgScoped<T extends Document>(orgId: ObjectId, filter: Filter<T> = {}): Filter<T> {
  return { ...filter, orgId };
}

export function notDeleted<T extends Document>(
  filter: Filter<T> = {},
  includeDeleted = false,
): Filter<T> {
  if (includeDeleted) return filter;
  return { ...filter, deleted: { $ne: true } };
}

export interface ParsedTagFilter {
  key: string;
  value?: string;
}

/**
 * Parses `?tag=team:platform` into a dotted-path filter. A bare `key` filters on the key's
 * existence so the UI can do coarse "has this tag" queries.
 */
export function parseTagFilter(tag: string | undefined): ParsedTagFilter | null {
  if (tag === undefined || tag.trim() === '') return null;
  const raw = tag.trim();
  const separator = raw.indexOf(':');
  if (separator === -1) return { key: raw };
  const key = raw.slice(0, separator);
  const value = raw.slice(separator + 1);
  if (key === '') return null;
  return value === '' ? { key } : { key, value };
}

export function tagFilterToMongo(tag: ParsedTagFilter): Record<string, unknown> {
  const path = `tags.${tag.key}`;
  if (tag.value === undefined) return { [path]: { $exists: true } };
  return { [path]: tag.value };
}

/** Builds the `$or` search clause used by list endpoints. */
export function searchOr(fields: readonly string[], regex: RegExp): Record<string, unknown> {
  return { $or: fields.map((field) => ({ [field]: regex })) };
}

export function combineFilters<T extends Document>(...filters: Filter<T>[]): Filter<T> {
  const merged: Record<string, unknown> = {};
  for (const filter of filters) {
    Object.assign(merged, filter);
  }
  return merged as Filter<T>;
}
