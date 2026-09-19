import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import type { PolicyStatement } from '@iamscope/types';
import type { PrincipalDoc } from '../db/documents';
import {
  computePolicySnapshotVersion,
  detectPatterns,
  ESCALATION_PATTERNS,
  severityForHops,
  statementGrantsAction,
  traverseAssumeRoleTargets,
} from './escalation';

function allow(actions: string[], resources: string[] = ['*']): PolicyStatement {
  return { sid: 'S', effect: 'Allow', actions, resources, conditions: [] };
}

function deny(actions: string[]): PolicyStatement {
  return { sid: 'D', effect: 'Deny', actions, resources: ['*'], conditions: [] };
}

const ACCOUNT = '123456789012';

describe('statementGrantsAction', () => {
  it('grants via an Allow statement', () => {
    const grant = statementGrantsAction([allow(['iam:PassRole'])], 'iam:PassRole', 'p1');
    expect(grant.granted).toBe(true);
    expect(grant.grantedBy).toBe('p1:S');
  });

  it('honours wildcards', () => {
    expect(statementGrantsAction([allow(['iam:*'])], 'iam:PassRole').granted).toBe(true);
    expect(statementGrantsAction([allow(['*'])], 'sts:AssumeRole').granted).toBe(true);
  });

  it('lets an explicit Deny win', () => {
    const grant = statementGrantsAction(
      [allow(['iam:PassRole']), deny(['iam:PassRole'])],
      'iam:PassRole',
    );
    expect(grant.granted).toBe(false);
    expect(grant.denied).toBe(true);
  });

  it('does not grant an unrelated action', () => {
    expect(statementGrantsAction([allow(['s3:GetObject'])], 'iam:PassRole').granted).toBe(false);
  });
});

describe('detectPatterns', () => {
  it('detects all five v1 patterns', () => {
    const statements = [
      allow(['iam:PassRole', 'lambda:CreateFunction', 'lambda:InvokeFunction', 'ec2:RunInstances']),
      allow(['iam:CreatePolicyVersion', 'iam:SetDefaultPolicyVersion']),
      allow(['iam:AttachRolePolicy']),
      allow(['sts:AssumeRole']),
    ];
    const detected = detectPatterns(statements)
      .map((pattern) => pattern.pattern)
      .sort();
    expect(detected).toEqual(
      [
        'assume-role-broader',
        'attach-policy',
        'create-policy-version-set-default',
        'passrole-createfunction-invoke',
        'passrole-runinstances',
      ].sort(),
    );
  });

  it('requires every action for an `all` pattern', () => {
    const detected = detectPatterns([allow(['iam:PassRole', 'lambda:CreateFunction'])]);
    expect(detected.map((pattern) => pattern.pattern)).not.toContain(
      'passrole-createfunction-invoke',
    );
  });

  it('accepts any one action for an `any` pattern', () => {
    const detected = detectPatterns([allow(['iam:AttachGroupPolicy'])]);
    expect(detected.map((pattern) => pattern.pattern)).toContain('attach-policy');
  });

  it('detects nothing for a harmless policy', () => {
    expect(detectPatterns([allow(['s3:GetObject'], ['arn:aws:s3:::b/*'])])).toHaveLength(0);
  });

  it('exposes five pattern definitions', () => {
    expect(ESCALATION_PATTERNS).toHaveLength(5);
  });
});

describe('severityForHops', () => {
  it('maps hop counts per §11.3', () => {
    expect(severityForHops(1)).toBe('low');
    expect(severityForHops(2)).toBe('medium');
    expect(severityForHops(3)).toBe('high');
    expect(severityForHops(9)).toBe('high');
  });
});

describe('computePolicySnapshotVersion', () => {
  it('sums versions plus the policy count', () => {
    expect(computePolicySnapshotVersion([{ currentVersion: 1 }, { currentVersion: 2 }])).toBe(5);
    expect(computePolicySnapshotVersion([])).toBe(0);
  });
});

describe('traverseAssumeRoleTargets', () => {
  function principal(arn: string, targets: string[]): PrincipalDoc {
    return {
      _id: new ObjectId(),
      orgId: new ObjectId(),
      type: 'Role',
      name: arn.split('/').pop() ?? arn,
      arn,
      attachedPolicies: [],
      groupMemberships: [],
      assumeRoleTargets: targets,
      boundaryPolicyId: null,
      tags: {},
      deleted: false,
      createdBy: new ObjectId(),
      updatedBy: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  const user = `arn:aws:iam::${ACCOUNT}:user/engineer`;
  const deploy = `arn:aws:iam::${ACCOUNT}:role/DeployRole`;
  const admin = `arn:aws:iam::${ACCOUNT}:role/AdminRole`;
  const audit = `arn:aws:iam::${ACCOUNT}:role/SecurityAuditRole`;

  const map = new Map<string, PrincipalDoc>([
    [user, principal(user, [deploy])],
    [deploy, principal(deploy, [admin])],
    [admin, principal(admin, [audit])],
    [audit, principal(audit, [])],
  ]);

  it('walks a multi-hop chain breadth-first', () => {
    const reachable = traverseAssumeRoleTargets(user, map, 5);
    expect(reachable.map((target) => target.arn)).toEqual([deploy, admin, audit]);
    expect(reachable.map((target) => target.hops)).toEqual([1, 2, 3]);
    expect(reachable[2]?.chain).toEqual([user, deploy, admin, audit]);
  });

  it('respects maxDepth', () => {
    expect(traverseAssumeRoleTargets(user, map, 1).map((target) => target.arn)).toEqual([deploy]);
  });

  it('does not loop forever on a cycle', () => {
    const cyclic = new Map(map);
    cyclic.set(audit, principal(audit, [user]));
    expect(traverseAssumeRoleTargets(user, cyclic, 5)).toHaveLength(3);
  });
});
