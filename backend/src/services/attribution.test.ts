import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import type { AuditEventDoc } from '../db/documents';
import { confidenceBand, scoreAuditCause, type AttributionHints } from './attribution';

const WINDOW_START = new Date('2026-03-01T10:00:00Z');
const WINDOW_END = new Date('2026-03-01T11:00:00Z');

function event(partial: Partial<AuditEventDoc>): AuditEventDoc {
  return {
    _id: new ObjectId(),
    orgId: new ObjectId(),
    timestamp: new Date('2026-03-01T10:30:00Z'),
    actorUserId: null,
    actorEmail: 'demo@iamscope.dev',
    actorType: 'user',
    action: 'policy.update',
    target: { type: 'policy', id: 'p1', name: 'S3-ReadOnly' },
    before: { statements: [] },
    after: { statements: [] },
    metadata: {},
    ...partial,
  };
}

const hints: AttributionHints = {
  policyIds: new Set(['p1']),
  policyNames: new Set(['S3-ReadOnly']),
  principalArns: new Set(['arn:aws:iam::123456789012:user/engineer']),
  windowStart: WINDOW_START,
  windowEnd: WINDOW_END,
};

describe('scoreAuditCause', () => {
  it('scores a policy mutation that the trace references highest', () => {
    const score = scoreAuditCause(event({}), hints);
    expect(score.weight).toBeGreaterThan(0.7);
    expect(score.rationale).toContain('policy referenced by the evaluation trace');
  });

  it('scores an unrelated event at zero', () => {
    const score = scoreAuditCause(
      event({
        action: 'apikey.create',
        target: { type: 'api_key', id: 'k1', name: 'ci-key' },
        before: null,
        after: null,
        timestamp: WINDOW_START,
      }),
      hints,
    );
    expect(score.weight).toBe(0);
    expect(score.rationale).toBe('No direct link to the scenario trace');
  });

  it('scores a principal attach lower than a referenced policy edit', () => {
    const principalScore = scoreAuditCause(
      event({
        action: 'principal.attach',
        target: { type: 'principal', id: 'pr1', name: 'engineer' },
      }),
      hints,
    );
    expect(principalScore.weight).toBeGreaterThan(0);
    expect(principalScore.weight).toBeLessThan(0.7);
  });

  it('weighs proximity to the later run', () => {
    const close = scoreAuditCause(event({ timestamp: new Date('2026-03-01T10:59:00Z') }), hints);
    const far = scoreAuditCause(event({ timestamp: new Date('2026-03-01T10:01:00Z') }), hints);
    expect(close.weight).toBeGreaterThan(far.weight);
  });

  it('never exceeds 1', () => {
    const score = scoreAuditCause(
      event({
        action: 'policy.delete',
        actorType: 'api_key',
        timestamp: new Date('2026-03-01T10:59:59Z'),
      }),
      hints,
    );
    expect(score.weight).toBeLessThanOrEqual(1);
    expect(score.weight).toBeGreaterThan(0.9);
  });
});

describe('confidenceBand', () => {
  it('maps scores onto the three bands', () => {
    expect(confidenceBand(0.9)).toBe('high');
    expect(confidenceBand(0.6)).toBe('medium');
    expect(confidenceBand(0.2)).toBe('low');
    expect(confidenceBand(0.75)).toBe('high');
    expect(confidenceBand(0.45)).toBe('medium');
  });
});
