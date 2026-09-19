import { describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { identity } from '../db/identity';
import type { SessionDoc } from '../db/documents';
import { hashPassword, needsRehash, verifyPassword } from './password';
import {
  generateApiKey,
  hashApiKey,
  randomToken,
  sha256Hex,
  timingSafeEqualHex,
  timingSafeEqualString,
} from './tokens';
import {
  activateSession,
  decideSessionState,
  shouldTouchLastSeen,
  sessionExpiresAt,
} from './sessions';
import { csrfMatches, apiRelativePath, shouldSkipCsrf } from './csrf';
import { roleAtLeast, roleFromScopes, scopesSatisfy, permissionsForRole } from './context';
import type { Request } from 'express';

describe('password hashing', () => {
  it('hashes with argon2id and verifies the round trip', async () => {
    const hash = await hashPassword('iamscope-demo-2026');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'iamscope-demo-2026')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password-here')).toBe(false);
  });

  it('produces a unique salt per hash', async () => {
    const a = await hashPassword('iamscope-demo-2026');
    const b = await hashPassword('iamscope-demo-2026');
    expect(a).not.toBe(b);
  });

  it('returns false instead of throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'iamscope-demo-2026')).toBe(false);
  });

  it('does not request a rehash for a current-parameter hash', async () => {
    const hash = await hashPassword('iamscope-demo-2026');
    expect(needsRehash(hash)).toBe(false);
    expect(needsRehash('garbage')).toBe(true);
  });
});

describe('token helpers', () => {
  it('generates url-safe random tokens', () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomToken(32)).not.toBe(token);
  });

  it('hashes deterministically with sha256', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).toHaveLength(64);
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });

  it('compares digests in constant time semantics', () => {
    expect(timingSafeEqualHex(sha256Hex('a'), sha256Hex('a'))).toBe(true);
    expect(timingSafeEqualHex(sha256Hex('a'), sha256Hex('b'))).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
    expect(timingSafeEqualHex('aa', 'aaa')).toBe(false);
    expect(timingSafeEqualString('token', 'token')).toBe(true);
    expect(timingSafeEqualString('token', 'tok')).toBe(false);
  });

  it('builds an API key with a display prefix and a hashed secret', () => {
    const key = generateApiKey();
    expect(key.secret.startsWith('imsk_')).toBe(true);
    expect(key.secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(key.prefix).toHaveLength(8);
    expect(key.keyHash).toBe(hashApiKey(key.secret));
    expect(key.keyHash).not.toContain(key.secret);
  });
});

describe('session state decisions', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  const base = {
    expiresAt: new Date('2026-03-10T12:00:00Z'),
    revokedAt: null as Date | null,
    lastSeenAt: new Date('2026-03-01T11:59:00Z'),
  };

  it('is active inside the window', () => {
    expect(decideSessionState(base, now, 0)).toBe('active');
  });

  it('reports revocation before expiry', () => {
    expect(
      decideSessionState({ ...base, revokedAt: new Date('2026-03-01T11:00:00Z') }, now, 0),
    ).toBe('revoked');
    expect(
      decideSessionState(
        {
          ...base,
          revokedAt: new Date('2026-03-01T11:00:00Z'),
          expiresAt: new Date('2026-02-01T00:00:00Z'),
        },
        now,
        0,
      ),
    ).toBe('revoked');
  });

  it('reports expiry', () => {
    expect(
      decideSessionState({ ...base, expiresAt: new Date('2026-03-01T11:00:00Z') }, now, 0),
    ).toBe('expired');
  });

  it('reports idleness only when an idle timeout is configured', () => {
    const stale = { ...base, lastSeenAt: new Date('2026-03-01T10:00:00Z') };
    expect(decideSessionState(stale, now, 0)).toBe('active');
    expect(decideSessionState(stale, now, 30)).toBe('idle');
  });

  it('touches lastSeenAt at most once a minute', () => {
    expect(shouldTouchLastSeen({ lastSeenAt: new Date('2026-03-01T11:59:30Z') }, now)).toBe(false);
    expect(shouldTouchLastSeen({ lastSeenAt: new Date('2026-03-01T11:58:00Z') }, now)).toBe(true);
  });

  it('expires 30 days after creation', () => {
    const created = new Date('2026-03-01T00:00:00Z');
    expect(sessionExpiresAt(created).toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });
});

describe('RBAC helpers', () => {
  it('ranks roles owner > admin > member > viewer', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('member', 'admin')).toBe(false);
    expect(roleAtLeast('viewer', 'viewer')).toBe(true);
    expect(roleAtLeast(null, 'viewer')).toBe(false);
  });

  it('maps API key scopes onto roles', () => {
    expect(roleFromScopes(['admin'])).toBe('admin');
    expect(roleFromScopes(['write'])).toBe('member');
    expect(roleFromScopes(['evaluate'])).toBe('member');
    expect(roleFromScopes(['read'])).toBe('viewer');
  });

  it('checks scope requirements with implications', () => {
    expect(scopesSatisfy(['admin'], 'admin')).toBe(true);
    expect(scopesSatisfy(['read'], 'write')).toBe(false);
    expect(scopesSatisfy(['write'], 'read')).toBe(true);
    expect(scopesSatisfy(['evaluate'], 'read')).toBe(true);
    expect(scopesSatisfy(['read'], 'admin')).toBe(false);
  });

  it('derives coarse permissions from a role', () => {
    expect(permissionsForRole('owner')).toEqual({
      canRead: true,
      canWrite: true,
      canEvaluate: true,
      canAdmin: true,
      canDeleteOrg: true,
    });
    expect(permissionsForRole('viewer').canWrite).toBe(false);
    expect(permissionsForRole(null).canRead).toBe(false);
    expect(permissionsForRole('admin').canDeleteOrg).toBe(false);
  });
});

describe('CSRF helpers', () => {
  it('requires a matching header and cookie', () => {
    expect(csrfMatches('abc', 'abc')).toBe(true);
    expect(csrfMatches('abc', 'abd')).toBe(false);
    expect(csrfMatches(undefined, 'abc')).toBe(false);
    expect(csrfMatches('abc', undefined)).toBe(false);
  });

  function request(method: string, url: string): Request {
    return { method, originalUrl: url, path: url, headers: {} } as unknown as Request;
  }

  it('skips safe methods', () => {
    expect(shouldSkipCsrf(request('GET', '/api/policies'))).toBe(true);
    expect(shouldSkipCsrf(request('OPTIONS', '/api/policies'))).toBe(true);
  });

  it('skips pre-session auth routes only', () => {
    expect(shouldSkipCsrf(request('POST', '/api/auth/login'))).toBe(true);
    expect(shouldSkipCsrf(request('POST', '/api/auth/signup'))).toBe(true);
    expect(shouldSkipCsrf(request('POST', '/api/invitations/abc/accept'))).toBe(true);
    expect(shouldSkipCsrf(request('POST', '/api/policies'))).toBe(false);
    expect(shouldSkipCsrf(request('POST', '/api/auth/switch-org'))).toBe(false);
  });

  it('derives the api-relative path', () => {
    expect(apiRelativePath(request('POST', '/api/policies?x=1'))).toBe('/policies');
    expect(apiRelativePath(request('GET', '/api'))).toBe('/');
  });
});

describe('auth context ids', () => {
  it('ObjectId round-trips through the helpers used by middleware', () => {
    const id = new ObjectId();
    expect(id.toHexString()).toHaveLength(24);
  });
});

/*
 * `activateSession` is where the liveness check and the `lastSeenAt` slide live, so it is the
 * only place the two session transports can diverge. These tests pin both halves.
 *
 * `identity` is mocked: the slide writes through to Mongo, but the decision is what is under
 * test here. The `idleMinutes` argument is passed explicitly on every call - the test
 * environment's `SESSION_IDLE_MINUTES` is unset (0), and `decideSessionState` treats 0 as
 * "idle checking disabled", which would make every assertion below vacuously pass.
 */
vi.mock('../db/identity', () => {
  const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
  return { identity: { sessions: () => ({ updateOne }) } };
});

const idleUpdateOne = (): ReturnType<typeof vi.fn> =>
  (identity.sessions() as unknown as { updateOne: ReturnType<typeof vi.fn> }).updateOne;

function sessionFixture(overrides: Partial<SessionDoc> = {}): SessionDoc {
  return {
    _id: new ObjectId(),
    tokenHash: 'a'.repeat(64),
    userId: new ObjectId(),
    activeOrgId: new ObjectId(),
    expiresAt: new Date('2026-03-10T12:00:00Z'),
    revokedAt: null,
    lastSeenAt: new Date('2026-03-01T11:50:00Z'),
    createdAt: new Date('2026-03-01T11:00:00Z'),
    ...overrides,
  } as unknown as SessionDoc;
}

describe('activateSession - idle window', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  const IDLE = 30;

  it('accepts a session idle well inside the limit', async () => {
    // 11:45:00 -> 12:00:00 is 15 minutes, half the window.
    const session = sessionFixture({ lastSeenAt: new Date('2026-03-01T11:45:00Z') });
    await expect(activateSession(session, now, IDLE)).resolves.not.toBeNull();
  });

  it('rejects a session one second past the limit', async () => {
    // 11:29:59 -> 12:00:00 is 30m01s, the smallest step outside the window.
    const session = sessionFixture({ lastSeenAt: new Date('2026-03-01T11:29:59Z') });
    expect(await activateSession(session, now, IDLE)).toBeNull();
  });

  it('accepts a session idle at exactly the limit', async () => {
    // `decideSessionState` uses a strict `>`, so the boundary itself is still active. Pinned
    // deliberately: this is the contract, not an implementation detail.
    const session = sessionFixture({ lastSeenAt: new Date('2026-03-01T11:30:00Z') });
    await expect(activateSession(session, now, IDLE)).resolves.not.toBeNull();
  });

  it('rejects idleness for a revoked session too, revocation winning', async () => {
    const session = sessionFixture({
      lastSeenAt: now,
      revokedAt: new Date('2026-03-01T11:00:00Z'),
    });
    expect(await activateSession(session, now, IDLE)).toBeNull();
  });

  it('rejects an expired session regardless of recent activity', async () => {
    const session = sessionFixture({
      lastSeenAt: now,
      expiresAt: new Date('2026-03-01T11:00:00Z'),
    });
    expect(await activateSession(session, now, IDLE)).toBeNull();
  });

  it('does not enforce idleness when the timeout is disabled', async () => {
    const session = sessionFixture({ lastSeenAt: new Date('2026-02-01T00:00:00Z') });
    await expect(activateSession(session, now, 0)).resolves.not.toBeNull();
  });

  it('slides lastSeenAt forward and persists it when activating', async () => {
    idleUpdateOne().mockClear();
    const session = sessionFixture({ lastSeenAt: new Date('2026-03-01T11:50:00Z') });

    const result = await activateSession(session, now, IDLE);

    // The side effect the cookie path always had: an in-memory slide plus a write.
    expect(result?.lastSeenAt.getTime()).toBe(now.getTime());
    expect(idleUpdateOne()).toHaveBeenCalledWith(
      { _id: session._id },
      { $set: { lastSeenAt: now } },
    );
  });

  it('skips the write when lastSeenAt was touched less than a minute ago', async () => {
    idleUpdateOne().mockClear();
    const session = sessionFixture({ lastSeenAt: new Date('2026-03-01T11:59:30Z') });

    await activateSession(session, now, IDLE);

    expect(idleUpdateOne()).not.toHaveBeenCalled();
  });
});
