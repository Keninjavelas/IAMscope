import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { clientIp } from './rateLimit';

describe('clientIp', () => {
  it('uses the address resolved by Express instead of an untrusted forwarded prefix', () => {
    const req = {
      ip: '74.220.48.42',
      headers: { 'x-forwarded-for': '192.0.2.123, 74.220.48.42' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    expect(clientIp(req)).toBe('74.220.48.42');
  });
});
