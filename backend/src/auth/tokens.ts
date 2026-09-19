/**
 * Opaque token generation + hashing (Plan §5.1: "Sessions: opaque tokens, sha256-hashed in DB").
 * No JWT anywhere in this codebase.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token. 32 bytes -> 43 chars of base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** sha256 of a token, hex encoded. This is what gets persisted. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison for equal-length hex digests. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Constant-time comparison for arbitrary strings (used by CSRF double-submit). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface GeneratedApiKey {
  /** Shown exactly once, never stored. */
  secret: string;
  /** First 8 characters, stored for display only. */
  prefix: string;
  /** sha256 hex of `secret`. */
  keyHash: string;
}

export const API_KEY_PREFIX = 'imsk';

/** `imsk_<32 bytes base64url>` - matches the shared `tokenSchema` character class. */
export function generateApiKey(): GeneratedApiKey {
  const secret = `${API_KEY_PREFIX}_${randomToken(32)}`;
  return { secret, prefix: secret.slice(0, 8), keyHash: sha256Hex(secret) };
}

export function hashApiKey(secret: string): string {
  return sha256Hex(secret);
}
