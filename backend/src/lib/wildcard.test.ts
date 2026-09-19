import { describe, expect, it } from 'vitest';
import {
  anyActionMatches,
  anyResourceMatches,
  clearWildcardCache,
  matchesAction,
  matchesResource,
  matchesWildcard,
  wildcardToRegExp,
} from './wildcard';

describe('wildcardToRegExp', () => {
  it('anchors the pattern', () => {
    const regex = wildcardToRegExp('s3:Get*');
    expect(regex.test('s3:GetObject')).toBe(true);
    expect(regex.test('xs3:GetObject')).toBe(false);
    expect(regex.test('s3:GetObjectExtra')).toBe(true);
  });

  it('translates ? to exactly one character', () => {
    expect(matchesWildcard('s3:Get?bject', 's3:GetObject')).toBe(true);
    expect(matchesWildcard('s3:Get?bject', 's3:GetOObject')).toBe(false);
  });

  it('escapes regex metacharacters in the pattern', () => {
    expect(matchesWildcard('arn:aws:s3:::b/*', 'arn:aws:s3:::b/x')).toBe(true);
    expect(matchesWildcard('a.b', 'axb')).toBe(false);
    expect(matchesWildcard('a.b', 'a.b')).toBe(true);
    expect(matchesWildcard('(x)', '(x)')).toBe(true);
  });

  it('supports case-insensitive compilation', () => {
    expect(matchesWildcard('s3:get*', 's3:GetObject', true)).toBe(true);
    expect(matchesWildcard('s3:get*', 's3:GetObject', false)).toBe(false);
  });

  it('caches compiled patterns without leaking state', () => {
    const first = wildcardToRegExp('ec2:*');
    const second = wildcardToRegExp('ec2:*');
    expect(first).toBe(second);
    clearWildcardCache();
    expect(wildcardToRegExp('ec2:*')).not.toBe(first);
  });
});

describe('matchesAction', () => {
  it('matches exact actions', () => {
    expect(matchesAction('s3:GetObject', 's3:GetObject')).toBe(true);
    expect(matchesAction('s3:GetObject', 's3:PutObject')).toBe(false);
  });

  it('treats * as everything', () => {
    expect(matchesAction('*', 'iam:PassRole')).toBe(true);
  });

  it('supports service and verb prefixes', () => {
    expect(matchesAction('s3:*', 's3:GetObject')).toBe(true);
    expect(matchesAction('s3:*', 'ec2:RunInstances')).toBe(false);
    expect(matchesAction('s3:Get*', 's3:GetBucketLocation')).toBe(true);
  });

  it('is case-insensitive, like AWS', () => {
    expect(matchesAction('s3:getobject', 's3:GetObject')).toBe(true);
  });
});

describe('matchesResource', () => {
  it('matches exact ARNs', () => {
    expect(matchesResource('arn:aws:s3:::bucket/key', 'arn:aws:s3:::bucket/key')).toBe(true);
  });

  it('matches path wildcards', () => {
    expect(matchesResource('arn:aws:s3:::bucket/*', 'arn:aws:s3:::bucket/a/b')).toBe(true);
    expect(matchesResource('arn:aws:s3:::bucket/reports/*', 'arn:aws:s3:::bucket/secrets/x')).toBe(
      false,
    );
  });

  it('treats * as everything', () => {
    expect(matchesResource('*', 'arn:aws:lambda:us-east-1:123456789012:function:f')).toBe(true);
  });

  it('is case-sensitive for ARNs', () => {
    expect(matchesResource('arn:aws:s3:::Bucket/*', 'arn:aws:s3:::bucket/x')).toBe(false);
  });
});

describe('array helpers', () => {
  it('anyActionMatches returns false for an empty list', () => {
    expect(anyActionMatches([], 's3:GetObject')).toBe(false);
    expect(anyActionMatches(['ec2:*'], 's3:GetObject')).toBe(false);
    expect(anyActionMatches(['ec2:*', 's3:*'], 's3:GetObject')).toBe(true);
  });

  it('anyResourceMatches returns false for an empty list', () => {
    expect(anyResourceMatches([], 'arn:aws:s3:::b/k')).toBe(false);
    expect(anyResourceMatches(['arn:aws:s3:::b/*'], 'arn:aws:s3:::b/k')).toBe(true);
  });
});
