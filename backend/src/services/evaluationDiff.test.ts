import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import type { EvaluationRunResult, TraceEntry } from '@iamscope/types';
import type { EvaluationRunDoc } from '../db/documents';
import { classifyTransition, diffEvaluations, statementDelta } from './evaluationDiff';

function trace(policyId: string, sid: string, effect: 'Allow' | 'Deny' = 'Allow'): TraceEntry {
  return {
    policyId,
    policyName: 'P',
    policyArn: 'arn:aws:iam::123456789012:policy/P',
    sid,
    effect,
    matchedAction: 's3:GetObject',
    matchedResource: '*',
    matchedConditions: [],
    source: 'principal',
    sourceName: 'tester',
  };
}

function result(
  scenarioId: string,
  value: 'Allow' | 'Deny',
  entries: TraceEntry[],
): EvaluationRunResult {
  return {
    scenarioId,
    scenarioName: `Scenario ${scenarioId}`,
    principalArn: 'arn:aws:iam::123456789012:user/engineer',
    action: 's3:GetObject',
    resourceArn: 'arn:aws:s3:::b/k',
    expectedResult: 'Allow',
    result: value,
    passed: value === 'Allow',
    trace: entries,
    reason: value === 'Allow' ? 'explicit-allow' : 'explicit-deny',
  };
}

function run(results: EvaluationRunResult[]): EvaluationRunDoc {
  const passed = results.filter((entry) => entry.passed).length;
  return {
    _id: new ObjectId(),
    orgId: new ObjectId(),
    label: 'run',
    snapshotAt: new Date('2026-01-01T00:00:00Z'),
    triggeredBy: 'manual',
    triggeredByUserId: null,
    causedByAuditEventId: null,
    results,
    summary: { total: results.length, passed, failed: results.length - passed },
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('classifyTransition', () => {
  it('classifies every transition the Impact lens renders', () => {
    expect(classifyTransition('Allow', 'Allow')).toBe('unchanged');
    expect(classifyTransition('Deny', 'Deny')).toBe('unchanged');
    expect(classifyTransition('Allow', 'Deny')).toBe('allow-to-deny');
    expect(classifyTransition('Deny', 'Allow')).toBe('deny-to-allow');
    expect(classifyTransition(null, 'Allow')).toBe('added');
    expect(classifyTransition('Allow', null)).toBe('removed');
    expect(classifyTransition(null, null)).toBe('unchanged');
  });
});

describe('statementDelta', () => {
  it('reports statements added and removed', () => {
    const delta = statementDelta(
      [trace('p1', 'A'), trace('p1', 'B')],
      [trace('p1', 'B'), trace('p2', 'C')],
    );
    expect(delta.removed).toEqual(['p1:A']);
    expect(delta.added).toEqual(['p2:C']);
  });

  it('is empty for identical traces', () => {
    const entries = [trace('p1', 'A')];
    expect(statementDelta(entries, entries)).toEqual({ removed: [], added: [] });
  });
});

describe('diffEvaluations', () => {
  it('counts each transition bucket', () => {
    const before = run([
      result('s1', 'Allow', [trace('p1', 'A')]),
      result('s2', 'Deny', [trace('p1', 'B')]),
      result('s3', 'Allow', [trace('p1', 'C')]),
    ]);
    const after = run([
      result('s1', 'Deny', [trace('p1', 'B')]),
      result('s2', 'Allow', [trace('p1', 'A')]),
      result('s3', 'Allow', [trace('p1', 'C')]),
      result('s4', 'Deny', []),
    ]);

    const diff = diffEvaluations(before, after);

    expect(diff.counts.total).toBe(4);
    expect(diff.counts.allowToDeny).toBe(1);
    expect(diff.counts.denyToAllow).toBe(1);
    expect(diff.counts.unchanged).toBe(1);
    expect(diff.counts.added).toBe(1);
    expect(diff.counts.removed).toBe(0);
    expect(diff.counts.changed).toBe(3);

    const s1 = diff.entries.find((entry) => entry.scenarioId === 's1');
    expect(s1?.transition).toBe('allow-to-deny');
    expect(s1?.removedStatements).toEqual(['p1:A']);
    expect(s1?.addedStatements).toEqual(['p1:B']);
  });

  it('reports removed scenarios when a run loses one', () => {
    const before = run([result('s1', 'Allow', []), result('s2', 'Allow', [])]);
    const after = run([result('s1', 'Allow', [])]);
    const diff = diffEvaluations(before, after);
    expect(diff.counts.removed).toBe(1);
  });

  it('treats a missing baseline as all-added', () => {
    const after = run([result('s1', 'Allow', [])]);
    const diff = diffEvaluations(null, after);
    expect(diff.before).toBeNull();
    expect(diff.counts.added).toBe(1);
    expect(diff.after.id).toBe(after._id.toHexString());
  });
});
