/**
 * `Result<T, E>` for service functions that can fail in an expected way (Plan §24).
 */
export type Result<T, E = Error> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/** `E extends Error` so the `throw` is provably an Error, not an arbitrary payload. */
export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** Lifts a possibly-null value into a `Result`. */
export function fromNullable<T, E>(value: T | null | undefined, error: E): Result<T, E> {
  return value === null || value === undefined ? err(error) : ok(value);
}
