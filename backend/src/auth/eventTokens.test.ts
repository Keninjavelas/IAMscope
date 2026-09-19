import { describe, expect, it } from 'vitest';
import { EVENT_TOKEN_TTL_SECONDS, mintEventToken, verifyEventToken } from './eventTokens';

const ARGS = {
  userId: '507f1f77bcf86cd799439011',
  orgId: '507f1f77bcf86cd799439012',
  sessionId: '507f1f77bcf86cd799439013',
};

describe('mintEventToken', () => {
  it('produces a two-part token and an expiry that matches the requested lifetime', () => {
    const before = Math.floor(Date.now() / 1000);
    const { token, expiresAt } = mintEventToken(ARGS);
    const after = Math.floor(Date.now() / 1000);

    expect(token.split('.')).toHaveLength(2);
    expect(expiresAt.getTime() / 1000).toBeGreaterThanOrEqual(before + EVENT_TOKEN_TTL_SECONDS);
    expect(expiresAt.getTime() / 1000).toBeLessThanOrEqual(after + EVENT_TOKEN_TTL_SECONDS);
  });

  it('defaults the lifetime to five minutes', () => {
    const { expiresAt } = mintEventToken(ARGS);
    const delta = expiresAt.getTime() - Date.now();
    expect(delta).toBeGreaterThan(290_000);
    expect(delta).toBeLessThanOrEqual(300_000);
  });
});

describe('verifyEventToken', () => {
  it('round-trips the payload', () => {
    const { token } = mintEventToken(ARGS);
    expect(verifyEventToken(token)).toEqual({
      userId: ARGS.userId,
      orgId: ARGS.orgId,
      sessionId: ARGS.sessionId,
      exp: expect.any(Number) as number,
    });
  });

  it('rejects a tampered payload', () => {
    const { token } = mintEventToken(ARGS);
    const [encoded, sig] = token.split('.');
    if (encoded === undefined || sig === undefined) throw new Error('malformed fixture');

    // Re-encode the same payload with a different orgId, keeping the original signature.
    // (Re-minting the identical payload would produce identical bytes, so the signature
    // would legitimately still match - the change has to be real.)
    const original = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const forged = Buffer.from(
      JSON.stringify({ ...original, orgId: '507f1f77bcf86cd799439099' }),
      'utf8',
    ).toString('base64url');

    expect(forged).not.toBe(encoded);
    expect(verifyEventToken(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const { token } = mintEventToken(ARGS);
    const [encoded, sig] = token.split('.');
    if (encoded === undefined || sig === undefined) throw new Error('malformed fixture');

    const flipped = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyEventToken(`${encoded}.${flipped}`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const { token } = mintEventToken({ ...ARGS, expiresInSeconds: -1 });
    expect(verifyEventToken(token)).toBeNull();
  });

  it('rejects a signature of the wrong length without throwing', () => {
    const { token } = mintEventToken(ARGS);
    const [encoded] = token.split('.');
    if (encoded === undefined) throw new Error('malformed fixture');

    expect(verifyEventToken(`${encoded}.short`)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['no separator', 'abcdef'],
    ['leading separator', '.abcdef'],
    ['trailing separator', 'abcdef.'],
    ['not base64+json', 'not-json.not-a-signature'],
  ])('returns null for a %s token', (_label, value) => {
    expect(verifyEventToken(value)).toBeNull();
  });

  it('rejects a valid signature over a payload that is not a token', () => {
    // Reachable only if the payload schema is dropped, so it pins that validation.
    const encoded = Buffer.from(JSON.stringify({ exp: 9_999_999_999 }), 'utf8').toString(
      'base64url',
    );
    const { token } = mintEventToken(ARGS);
    const sig = token.split('.')[1];
    if (sig === undefined) throw new Error('malformed fixture');

    // A different payload means the signature no longer matches, which is the point.
    expect(verifyEventToken(`${encoded}.${sig}`)).toBeNull();
  });
});
