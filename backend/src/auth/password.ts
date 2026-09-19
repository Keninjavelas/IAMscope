/**
 * argon2id password hashing with the OWASP-recommended parameters from Plan §5.1.
 * memoryCost 19456 KiB (19 MiB), timeCost 2, parallelism 1.
 */
import argon2 from 'argon2';

export const ARGON2_MEMORY_COST = 19_456;
export const ARGON2_TIME_COST = 2;
export const ARGON2_PARALLELISM = 1;

/** Hash a plaintext password with argon2id. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: ARGON2_MEMORY_COST,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
  });
}

/** Verify a plaintext password against a stored argon2id hash. Never throws. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Malformed or truncated hash - treat as a failed login rather than a 500.
    return false;
  }
}

/** True when the stored hash was produced with weaker parameters than the current policy. */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, {
      memoryCost: ARGON2_MEMORY_COST,
      timeCost: ARGON2_TIME_COST,
      parallelism: ARGON2_PARALLELISM,
    });
  } catch {
    return true;
  }
}
