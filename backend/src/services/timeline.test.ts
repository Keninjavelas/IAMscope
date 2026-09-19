import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  bucketByDay,
  emptyCategoryCounts,
  invalidateTimelineCache,
  roundToMinute,
  timelineCacheKey,
  timelineCacheSize,
  toEventMarker,
} from './timeline';
import type { AuditEventDoc } from '../db/documents';

describe('roundToMinute', () => {
  it('zeroes seconds and milliseconds without mutating the input', () => {
    const input = new Date('2026-03-01T10:15:42.123Z');
    const rounded = roundToMinute(input);
    expect(rounded.toISOString()).toBe('2026-03-01T10:15:00.000Z');
    expect(input.toISOString()).toBe('2026-03-01T10:15:42.123Z');
  });
});

describe('timelineCacheKey', () => {
  it('is stable within the same minute', () => {
    const orgId = new ObjectId();
    const a = timelineCacheKey(orgId, new Date('2026-03-01T10:15:01Z'));
    const b = timelineCacheKey(orgId, new Date('2026-03-01T10:15:59Z'));
    expect(a).toBe(b);
  });

  it('differs across minutes and orgs', () => {
    const orgId = new ObjectId();
    const other = new ObjectId();
    expect(timelineCacheKey(orgId, new Date('2026-03-01T10:15:00Z'))).not.toBe(
      timelineCacheKey(orgId, new Date('2026-03-01T10:16:00Z')),
    );
    expect(timelineCacheKey(orgId, new Date('2026-03-01T10:15:00Z'))).not.toBe(
      timelineCacheKey(other, new Date('2026-03-01T10:15:00Z')),
    );
  });
});

describe('emptyCategoryCounts', () => {
  it('has a zero for every timeline category', () => {
    const counts = emptyCategoryCounts();
    expect(Object.values(counts).every((value) => value === 0)).toBe(true);
    expect(Object.keys(counts).sort()).toEqual(
      ['apikey', 'membership', 'org', 'policy', 'principal', 'resource', 'scenario'].sort(),
    );
  });
});

describe('bucketByDay', () => {
  it('groups events per UTC day and per category', () => {
    const buckets = bucketByDay([
      { timestamp: new Date('2026-03-01T01:00:00Z'), category: 'policy' },
      { timestamp: new Date('2026-03-01T23:59:00Z'), category: 'policy' },
      { timestamp: new Date('2026-03-01T12:00:00Z'), category: 'principal' },
      { timestamp: new Date('2026-03-02T00:00:00Z'), category: 'resource' },
    ]);

    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.day).toBe('2026-03-01');
    expect(buckets[0]?.counts.policy).toBe(2);
    expect(buckets[0]?.counts.principal).toBe(1);
    expect(buckets[0]?.counts.resource).toBe(0);
    expect(buckets[0]?.total).toBe(3);
    expect(buckets[1]?.day).toBe('2026-03-02');
    expect(buckets[1]?.total).toBe(1);
  });

  it('returns nothing for an empty range', () => {
    expect(bucketByDay([])).toEqual([]);
  });
});

describe('toEventMarker', () => {
  it('maps an audit document to a scrubber marker', () => {
    const doc: AuditEventDoc = {
      _id: new ObjectId(),
      orgId: new ObjectId(),
      timestamp: new Date('2026-03-01T10:00:00Z'),
      actorUserId: null,
      actorEmail: 'demo@iamscope.dev',
      actorType: 'user',
      action: 'policy.update',
      target: { type: 'policy', id: new ObjectId().toHexString(), name: 'S3-ReadOnly' },
      before: null,
      after: null,
      metadata: {},
    };

    const marker = toEventMarker(doc);
    expect(marker.category).toBe('policy');
    expect(marker.action).toBe('policy.update');
    expect(marker.summary).toBe('update: S3-ReadOnly');
    expect(marker.actorEmail).toBe('demo@iamscope.dev');
  });

  it('falls back to the org category for unknown actions', () => {
    const doc = {
      _id: new ObjectId(),
      orgId: new ObjectId(),
      timestamp: new Date(),
      actorUserId: null,
      actorEmail: null,
      actorType: 'system' as const,
      action: 'weird.thing',
      target: { type: 'org', id: 'x', name: 'Acme' },
      before: null,
      after: null,
      metadata: {},
    };
    expect(toEventMarker(doc).category).toBe('org');
  });
});

describe('timeline cache invalidation', () => {
  it('exposes a size and clears without throwing', () => {
    expect(typeof timelineCacheSize()).toBe('number');
    invalidateTimelineCache(new ObjectId());
    invalidateTimelineCache();
    expect(timelineCacheSize()).toBe(0);
  });
});
