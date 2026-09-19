/**
 * Short-lived tokens for authenticating a cross-origin SSE stream (Fallback B).
 *
 * Why this exists: in production the frontend reaches the API through the Vercel rewrite,
 * which makes every call same-origin and lets the session cookie work under
 * `SameSite=lax`. If Vercel's edge turns out to buffer `text/event-stream`, the fallback is
 * to point the `EventSource` straight at the Render origin - where the session cookie would
 * be a third-party cookie and would not be sent. This token stands in for the cookie on
 * that one connection, so no cookie policy has to change.
 *
 * Format: `<base64url(payload)>.<base64url(hmacSha256(payload))>`. Verification is
 * stateless - a signature check plus an expiry check, no storage.
 *
 * NOT CURRENTLY WIRED UP. The route and middleware that consume it are deliberately not
 * registered yet: the deploy gate (Phase 12 step 5) has to show that cookie-mode SSE fails
 * through Vercel before token mode earns its place. See `scripts/deploy-handoff.md` §6.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env';

/** How long a minted token stays valid. Short: it only has to outlive one connection. */
export const EVENT_TOKEN_TTL_SECONDS = 300;

const payloadSchema = z.object({
  userId: z.string().min(1),
  orgId: z.string().min(1),
  sessionId: z.string().min(1),
  /** Unix seconds. */
  exp: z.number().int().positive(),
});

export type EventTokenPayload = z.infer<typeof payloadSchema>;

export interface EventToken {
  readonly token: string;
  readonly expiresAt: Date;
}

function signature(encodedPayload: string): Buffer {
  return createHmac('sha256', env.SESSION_SECRET).update(encodedPayload).digest();
}

export function mintEventToken(args: {
  userId: string;
  orgId: string;
  sessionId: string;
  expiresInSeconds?: number;
}): EventToken {
  const expiresInSeconds = args.expiresInSeconds ?? EVENT_TOKEN_TTL_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;

  const payload: EventTokenPayload = {
    userId: args.userId,
    orgId: args.orgId,
    sessionId: args.sessionId,
    exp,
  };

  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const token = `${encoded}.${signature(encoded).toString('base64url')}`;

  return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * Returns the payload only if the signature is valid AND the token has not expired.
 *
 * Every failure mode returns `null` rather than throwing - this runs on an unauthenticated
 * route parameter, so it must not be a source of 500s. A valid token proves *who minted it*
 * and *which session it was minted for*; the caller must still confirm that session is live.
 */
export function verifyEventToken(token: string): EventTokenPayload | null {
  const separator = token.indexOf('.');
  if (separator <= 0) return null;

  const encoded = token.slice(0, separator);
  const provided = token.slice(separator + 1);

  const providedBytes = Buffer.from(provided, 'base64url');
  const expectedBytes = signature(encoded);
  // `timingSafeEqual` throws on a length mismatch, so that has to be checked first.
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) return null;

  if (parsed.data.exp < Math.floor(Date.now() / 1000)) return null;

  return parsed.data;
}
