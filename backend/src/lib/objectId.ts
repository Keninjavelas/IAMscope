import { ObjectId } from 'mongodb';

/** 24-character hex string check that does not throw on malformed input. */
export function isObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}

/**
 * True only for a real `ObjectId` instance.
 *
 * Deliberately *not* true for a 24-hex string, even though one can be converted. The previous
 * implementation returned `true` for strings while declaring `value is ObjectId`, which made
 * the predicate unsound: a caller could validate a string and then hand it to
 * `findOne({ _id })`, where it silently matches nothing because the query expects an
 * `ObjectId`. That is exactly the bug the SSE event-token tests caught.
 *
 * For strings use {@link isObjectIdString} to validate, then {@link toObjectId} to convert.
 */
export function isObjectId(value: unknown): value is ObjectId {
  return value instanceof ObjectId;
}

/** Coerces a hex string or `ObjectId` into an `ObjectId`. Throws on malformed input. */
export function toObjectId(value: string | ObjectId): ObjectId {
  if (value instanceof ObjectId) return value;
  return new ObjectId(value);
}

/** `ObjectId` -> hex string. `null`/`undefined` stay `null`. */
export function oidString(value: ObjectId | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof ObjectId ? value.toHexString() : value;
}

/** Required variant of {@link oidString} - falls back to the empty string. */
export function oidRequired(value: ObjectId | string): string {
  return value instanceof ObjectId ? value.toHexString() : value;
}

export function oidOrNull(value: string | ObjectId | null | undefined): ObjectId | null {
  if (value === null || value === undefined) return null;
  return value instanceof ObjectId ? value : new ObjectId(value);
}

export function sameId(a: ObjectId | null | undefined, b: ObjectId | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return oidRequired(a) === oidRequired(b);
}
