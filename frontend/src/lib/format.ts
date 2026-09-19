/**
 * Presentation formatting (Plan §6 `lib/format.ts`).
 *
 * ARNs are the hardest thing in this UI: they are long, they are the primary
 * identifier, and they must never widen a table. `truncateArn` keeps the two
 * meaningful ends (service + resource name) and elides the middle.
 */
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

export type DateInput = string | number | Date | null | undefined;

export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return isValid(fromNumber) ? fromNumber : null;
  }
  const parsed = parseISO(value);
  if (isValid(parsed)) return parsed;
  const fallback = new Date(value);
  return isValid(fallback) ? fallback : null;
}

/** `2026-04-02 14:31` - compact, monospaced-friendly, locale-independent enough. */
export function formatDate(value: DateInput, pattern = 'yyyy-MM-dd HH:mm'): string {
  const date = toDate(value);
  if (date === null) return '—';
  return format(date, pattern);
}

export function formatDateOnly(value: DateInput): string {
  return formatDate(value, 'yyyy-MM-dd');
}

export function formatTime(value: DateInput): string {
  return formatDate(value, 'HH:mm:ss');
}

/** `3 hours ago` - always relative, never a raw timestamp. */
export function formatRelative(value: DateInput, suffix = true): string {
  const date = toDate(value);
  if (date === null) return '—';
  try {
    return formatDistanceToNowStrict(date, { addSuffix: suffix });
  } catch {
    return '—';
  }
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (Math.abs(value) < 1000) return String(value);
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/* ------------------------------------------------------------------ */
/* Identifiers                                                        */
/* ------------------------------------------------------------------ */

export interface TruncateArnOptions {
  /** Characters kept at the front. Default 26 (covers `arn:aws:service:region:`). */
  head?: number;
  /** Characters kept at the end (the resource path is the interesting part). */
  tail?: number;
  /** Hard cap. Anything shorter is returned untouched. */
  max?: number;
}

/**
 * `arn:aws:iam::123456789012:role/very/long/name` ->
 * `arn:aws:iam::1234567890…long/name`
 *
 * Never used as the sole source of truth: every call site also exposes the full
 * ARN through a `title` or the hover-to-preview popover.
 */
export function truncateArn(
  arn: string | null | undefined,
  options: TruncateArnOptions = {},
): string {
  if (!arn) return '—';
  const { head = 26, tail = 16, max = 48 } = options;
  if (arn.length <= max) return arn;
  if (head + tail + 1 >= arn.length) return arn;
  return `${arn.slice(0, head)}…${arn.slice(arn.length - tail)}`;
}

/** Split an ARN so the resource name can be rendered on its own. */
export function arnParts(arn: string | null | undefined): {
  service: string;
  region: string;
  accountId: string;
  resource: string;
  resourceName: string;
} {
  const empty = { service: '', region: '', accountId: '', resource: '', resourceName: '' };
  if (!arn) return empty;
  const segments = arn.split(':');
  if (segments.length < 6) return empty;
  const resource = segments.slice(5).join(':');
  const slash = resource.lastIndexOf('/');
  return {
    service: segments[2] ?? '',
    region: segments[3] ?? '',
    accountId: segments[4] ?? '',
    resource,
    resourceName: slash === -1 ? resource : resource.slice(slash + 1),
  };
}

/** The last path segment of an ARN, or the whole string when there is none. */
export function arnName(arn: string | null | undefined): string {
  if (!arn) return '—';
  const parts = arnParts(arn);
  return parts.resourceName === '' ? arn : parts.resourceName;
}

export function truncateMiddle(value: string, max = 40, elision = '…'): string {
  if (value.length <= max) return value;
  const half = Math.floor((max - elision.length) / 2);
  return `${value.slice(0, half)}${elision}${value.slice(value.length - half)}`;
}

/* ------------------------------------------------------------------ */
/* Text                                                              */
/* ------------------------------------------------------------------ */

export function pluralise(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${formatCount(count)} ${word}`;
}

/** `0` -> `false + 0 rows` (opinionated: counts read better with the noun). */
export function pluraliseBare(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${word}`;
}

export function initials(name: string, max = 2): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  const letters = parts
    .slice(0, max)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return letters === '' ? '?' : letters;
}

export function titleCase(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** `policy.update` -> `Policy update` (used for audit + SSE labels). */
export function humaniseAction(action: string): string {
  return titleCase(action);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function serialiseJson(value: unknown, space = 2): string {
  try {
    // `JSON.stringify` is declared as `string` but returns `undefined` for
    // undefined/function/symbol inputs. Asserting the real signature is what makes the
    // `??` meaningful rather than dead.
    const json = JSON.stringify(value, null, space) as string | undefined;
    return json ?? '';
  } catch {
    return '';
  }
}
