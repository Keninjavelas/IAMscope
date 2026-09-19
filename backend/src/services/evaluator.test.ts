import { describe, expect, it } from 'vitest';
import type { PolicyStatement } from '@iamscope/types';
import {
  conditionSatisfied,
  evaluateCondition,
  evaluatePolicies,
  matchStatement,
  type EvaluatorPolicySource,
} from './evaluator';

const BUCKET = 'arn:aws:s3:::acme-prod-data';
const OBJECT = 'arn:aws:s3:::acme-prod-data/reports/q1.csv';

function statement(partial: Partial<PolicyStatement>): PolicyStatement {
  return {
    sid: partial.sid ?? '',
    effect: partial.effect ?? 'Allow',
    actions: partial.actions ?? ['s3:GetObject'],
    resources: partial.resources ?? [OBJECT],
    conditions: partial.conditions ?? [],
  };
}

function source(
  statements: PolicyStatement[],
  overrides: Partial<EvaluatorPolicySource> = {},
): EvaluatorPolicySource {
  return {
    id: overrides.id ?? 'p1',
    name: overrides.name ?? 'TestPolicy',
    arn: overrides.arn ?? 'arn:aws:iam::123456789012:policy/TestPolicy',
    statements,
    source: overrides.source ?? 'principal',
    sourceName: overrides.sourceName ?? 'tester',
  };
}

/* ------------------------------------------------------------------ */
/* §10.4 matching                                                      */
/* ------------------------------------------------------------------ */

describe('matchStatement', () => {
  it('requires both action and resource to match', () => {
    expect(matchStatement(statement({}), 's3:GetObject', OBJECT).matched).toBe(true);
    expect(matchStatement(statement({}), 's3:PutObject', OBJECT).matched).toBe(false);
    expect(matchStatement(statement({}), 's3:GetObject', BUCKET).matched).toBe(false);
  });

  it('reports which pattern matched', () => {
    const match = matchStatement(
      statement({ actions: ['s3:Get*'], resources: ['*'] }),
      's3:GetObject',
      OBJECT,
    );
    expect(match.matched).toBe(true);
    expect(match.matchedAction).toBe('s3:Get*');
    expect(match.matchedResource).toBe('*');
  });

  it('blocks the match when a condition is unsatisfied', () => {
    const withCondition = statement({
      conditions: [{ operator: 'StringLike', key: 's3:prefix', values: ['reports/*'] }],
    });
    expect(
      matchStatement(withCondition, 's3:GetObject', OBJECT, { 's3:prefix': 'secrets/x' }).matched,
    ).toBe(false);
    expect(
      matchStatement(withCondition, 's3:GetObject', OBJECT, { 's3:prefix': 'reports/q1' }).matched,
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* §10.4 conditions                                                    */
/* ------------------------------------------------------------------ */

describe('condition operators', () => {
  it('StringEquals is exact and case-sensitive', () => {
    expect(conditionSatisfied({ operator: 'StringEquals', key: 'k', values: ['v'] }, ['v'])).toBe(
      true,
    );
    expect(conditionSatisfied({ operator: 'StringEquals', key: 'k', values: ['v'] }, ['V'])).toBe(
      false,
    );
    expect(conditionSatisfied({ operator: 'StringEquals', key: 'k', values: ['v'] }, [])).toBe(
      false,
    );
  });

  it('StringLike supports wildcards', () => {
    expect(
      conditionSatisfied({ operator: 'StringLike', key: 'k', values: ['reports/*'] }, [
        'reports/q1',
      ]),
    ).toBe(true);
    expect(
      conditionSatisfied({ operator: 'StringLike', key: 'k', values: ['reports/*'] }, [
        'secrets/q1',
      ]),
    ).toBe(false);
  });

  it('ArnLike matches case-insensitively', () => {
    expect(
      conditionSatisfied(
        {
          operator: 'ArnLike',
          key: 'aws:PrincipalArn',
          values: ['arn:aws:iam::123456789012:role/*'],
        },
        ['arn:aws:iam::123456789012:role/DeployRole'],
      ),
    ).toBe(true);
    expect(
      conditionSatisfied(
        {
          operator: 'ArnLike',
          key: 'aws:PrincipalArn',
          values: ['arn:aws:iam::123456789012:role/*'],
        },
        ['arn:aws:iam::123456789012:user/bob'],
      ),
    ).toBe(false);
  });

  it('treats a missing context key as unsatisfied', () => {
    expect(conditionSatisfied({ operator: 'StringEquals', key: 'k', values: ['v'] }, [])).toBe(
      false,
    );
  });

  it('passes through v2 operators instead of creating false Denies', () => {
    expect(
      conditionSatisfied({ operator: 'Bool', key: 'aws:SecureTransport', values: ['true'] }, []),
    ).toBe(true);
    expect(
      conditionSatisfied(
        { operator: 'IpAddress', key: 'aws:SourceIp', values: ['10.0.0.0/8'] },
        [],
      ),
    ).toBe(true);
  });

  it('evaluateCondition returns a traceable result', () => {
    const result = evaluateCondition(
      { operator: 'StringEquals', key: 'aws:RequestedRegion', values: ['us-east-1'] },
      {
        'aws:RequestedRegion': 'us-east-1',
      },
    );
    expect(result).toEqual({
      operator: 'StringEquals',
      key: 'aws:RequestedRegion',
      expected: ['us-east-1'],
      satisfied: true,
    });
  });
});

/* ------------------------------------------------------------------ */
/* §10.5 result logic                                                  */
/* ------------------------------------------------------------------ */

describe('evaluatePolicies result logic', () => {
  it('returns implicit-deny with no matching statements', () => {
    const outcome = evaluatePolicies({
      policies: [source([statement({ actions: ['s3:PutObject'] })])],
      action: 's3:GetObject',
      resourceArn: OBJECT,
    });
    expect(outcome.result).toBe('Deny');
    expect(outcome.reason).toBe('implicit-deny');
    expect(outcome.trace).toHaveLength(0);
  });

  it('returns no-policy when nothing is attached', () => {
    const outcome = evaluatePolicies({ policies: [], action: 's3:GetObject', resourceArn: OBJECT });
    expect(outcome.result).toBe('Deny');
    expect(outcome.reason).toBe('no-policy');
  });

  it('allows on an explicit Allow', () => {
    const outcome = evaluatePolicies({
      policies: [source([statement({ sid: 'A' })])],
      action: 's3:GetObject',
      resourceArn: OBJECT,
    });
    expect(outcome.result).toBe('Allow');
    expect(outcome.reason).toBe('explicit-allow');
    expect(outcome.trace[0]?.sid).toBe('A');
    expect(outcome.evaluatedPolicies).toBe(1);
  });

  it('explicit Deny wins over Allow', () => {
    const outcome = evaluatePolicies({
      policies: [
        source([statement({ sid: 'AllowAll', resources: ['*'] })], { id: 'p1' }),
        source(
          [
            statement({
              sid: 'DenySecrets',
              effect: 'Deny',
              actions: ['s3:GetObject'],
              resources: ['arn:aws:s3:::acme-prod-data/*'],
            }),
          ],
          { id: 'p2', name: 'DenyPolicy' },
        ),
      ],
      action: 's3:GetObject',
      resourceArn: OBJECT,
    });
    expect(outcome.result).toBe('Deny');
    expect(outcome.reason).toBe('explicit-deny');
    expect(outcome.trace.map((entry) => entry.sid).sort()).toEqual(['AllowAll', 'DenySecrets']);
  });

  it('a boundary that does not allow the action denies it', () => {
    const outcome = evaluatePolicies({
      policies: [source([statement({ sid: 'Allow' })])],
      boundary: {
        policyId: 'b1',
        name: 'Boundary',
        arn: 'arn:aws:iam::123456789012:policy/Boundary',
        statements: [statement({ sid: 'BoundaryAllow', actions: ['ec2:*'] })],
      },
      action: 's3:GetObject',
      resourceArn: OBJECT,
    });
    expect(outcome.result).toBe('Deny');
    expect(outcome.reason).toBe('boundary-deny');
    expect(outcome.boundaryPolicyId).toBe('b1');
    expect(outcome.evaluatedPolicies).toBe(2);
  });

  it('a boundary that allows the action keeps the Allow', () => {
    const outcome = evaluatePolicies({
      policies: [source([statement({ sid: 'Allow' })])],
      boundary: {
        policyId: 'b1',
        name: 'Boundary',
        arn: 'arn:aws:iam::123456789012:policy/Boundary',
        statements: [statement({ sid: 'BoundaryAllow', actions: ['s3:*'] })],
      },
      action: 's3:GetObject',
      resourceArn: OBJECT,
    });
    expect(outcome.result).toBe('Allow');
    expect(outcome.trace.some((entry) => entry.source === 'boundary')).toBe(true);
  });

  it('an explicit Deny in the boundary denies even when policies allow', () => {
    const outcome = evaluatePolicies({
      policies: [source([statement({ sid: 'Allow' })])],
      boundary: {
        policyId: 'b1',
        name: 'Boundary',
        arn: 'arn:aws:iam::123456789012:policy/Boundary',
        statements: [statement({ sid: 'BoundaryDeny', effect: 'Deny', resources: ['*'] })],
      },
      action: 's3:GetObject',
      resourceArn: OBJECT,
    });
    expect(outcome.result).toBe('Deny');
    expect(outcome.reason).toBe('boundary-deny');
  });

  it('records group sources on the trace', () => {
    const outcome = evaluatePolicies({
      policies: [
        source([statement({ sid: 'FromGroup' })], {
          id: 'g1',
          source: 'group',
          sourceName: 'PlatformGroup',
        }),
      ],
      action: 's3:GetObject',
      resourceArn: OBJECT,
    });
    expect(outcome.trace[0]?.source).toBe('group');
    expect(outcome.trace[0]?.sourceName).toBe('PlatformGroup');
  });
});
