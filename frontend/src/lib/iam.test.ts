import { describe, expect, it } from 'vitest';
import type { PolicyStatement } from '@iamscope/types';
import {
  countByEffect,
  describeEffect,
  hasWildcards,
  isBroadWildcardArn,
  isFullWildcardAction,
  isWildcardAction,
  isWildcardResource,
  newStatement,
  parseStatementsJson,
  statementLabel,
  statementWarnings,
  statementsToDocument,
} from './iam';

function statement(overrides: Partial<PolicyStatement> = {}): PolicyStatement {
  return {
    sid: 'TestStatement',
    effect: 'Allow',
    actions: ['s3:GetObject'],
    resources: ['arn:aws:s3:::reports/monthly.csv'],
    conditions: [],
    ...overrides,
  };
}

describe('wildcard helpers', () => {
  it('treats a bare star, a partial star and a single-char wildcard as wildcards', () => {
    expect(isWildcardAction('*')).toBe(true);
    expect(isWildcardAction('s3:*')).toBe(true);
    expect(isWildcardAction('s3:GetObjec?')).toBe(true);
    expect(isWildcardAction('s3:GetObject')).toBe(false);
  });

  it('separates the full wildcard from a scoped one', () => {
    expect(isFullWildcardAction('*')).toBe(true);
    // `s3:*` is broad but is not "every action in the account".
    expect(isFullWildcardAction('s3:*')).toBe(false);
  });

  it('flags resources the same way', () => {
    expect(isWildcardResource('*')).toBe(true);
    expect(isWildcardResource('arn:aws:s3:::bucket/*')).toBe(true);
    expect(isWildcardResource('arn:aws:s3:::bucket/key')).toBe(false);
  });

  it('detects the classic over-grant ARNs', () => {
    expect(isBroadWildcardArn('arn:aws:s3:::*')).toBe(true);
    expect(isBroadWildcardArn('arn:aws:s3:::bucket/*')).toBe(true);
    // A star in the middle is scoped, not a namespace-wide grant.
    expect(isBroadWildcardArn('arn:aws:s3:::bucket/*/tail')).toBe(false);
  });
});

describe('statementWarnings', () => {
  it('reports a full wildcard action and a namespace-wide resource', () => {
    const warnings = statementWarnings(
      statement({ actions: ['*'], resources: ['arn:aws:s3:::bucket/*'] }),
    );

    expect(warnings.fullWildcard).toBe(true);
    expect(warnings.wildcardActions).toEqual(['*']);
    expect(warnings.broadResources).toEqual(['arn:aws:s3:::bucket/*']);
    expect(warnings.missingActions).toBe(false);
    expect(warnings.missingResources).toBe(false);
  });

  it('reports missing actions and resources rather than wildcards', () => {
    const warnings = statementWarnings(statement({ actions: [], resources: [] }));

    expect(warnings.missingActions).toBe(true);
    expect(warnings.missingResources).toBe(true);
    expect(warnings.wildcardActions).toEqual([]);
    expect(warnings.fullWildcard).toBe(false);
  });

  it('keeps an exact-match statement clean', () => {
    const warnings = statementWarnings(statement());

    expect(warnings).toEqual({
      wildcardActions: [],
      fullWildcard: false,
      wildcardResources: [],
      broadResources: [],
      missingResources: false,
      missingActions: false,
    });
  });
});

describe('hasWildcards', () => {
  it('is false for a fully specified statement', () => {
    expect(hasWildcards(statement())).toBe(false);
  });

  it('is true when only the resource side is wildcarded', () => {
    expect(hasWildcards(statement({ resources: ['*'] }))).toBe(true);
  });

  it('is true when only the action side is wildcarded', () => {
    expect(hasWildcards(statement({ actions: ['s3:Get*'] }))).toBe(true);
  });
});

describe('describeEffect', () => {
  it('marks an explicit deny as overriding (Plan 10.5)', () => {
    const deny = describeEffect('Deny');

    expect(deny.label).toBe('Deny');
    expect(deny.verb).toBe('Denies');
    expect(deny.tone).toBe('deny');
    expect(deny.overrides).toBe(true);
  });

  it('does not mark an allow as overriding', () => {
    const allow = describeEffect('Allow');

    expect(allow.label).toBe('Allow');
    expect(allow.verb).toBe('Allows');
    expect(allow.tone).toBe('allow');
    expect(allow.overrides).toBe(false);
  });
});

describe('countByEffect', () => {
  it('counts both effects, including zeroes', () => {
    const counts = countByEffect([
      statement({ sid: 'A' }),
      statement({ sid: 'B' }),
      statement({ sid: 'C', effect: 'Deny' }),
    ]);

    expect(counts).toEqual({ Allow: 2, Deny: 1 });
  });
});

describe('statementsToDocument', () => {
  it('emits canonical AWS keys with the standard version', () => {
    const doc = statementsToDocument([statement()]);

    expect(doc.Version).toBe('2012-10-17');
    expect(doc.Statement).toHaveLength(1);
    expect(doc.Statement[0]?.Sid).toBe('TestStatement');
    expect(doc.Statement[0]?.Effect).toBe('Allow');
  });

  it('collapses a single action and resource to scalars', () => {
    const doc = statementsToDocument([statement()]);

    expect(doc.Statement[0]?.Action).toBe('s3:GetObject');
    expect(doc.Statement[0]?.Resource).toBe('arn:aws:s3:::reports/monthly.csv');
  });

  it('keeps a list when there is more than one action', () => {
    const doc = statementsToDocument([statement({ actions: ['s3:GetObject', 's3:PutObject'] })]);

    expect(doc.Statement[0]?.Action).toEqual(['s3:GetObject', 's3:PutObject']);
  });

  it('omits Sid when it is blank, so the document stays schema-valid', () => {
    const doc = statementsToDocument([statement({ sid: '   ' })]);

    expect(doc.Statement[0]).not.toHaveProperty('Sid');
  });

  it('omits the condition block entirely when there are no conditions', () => {
    const doc = statementsToDocument([statement({ conditions: [] })]);

    expect(doc.Statement[0]).not.toHaveProperty('Condition');
  });

  it('groups conditions by operator and key', () => {
    const doc = statementsToDocument([
      statement({
        conditions: [
          { operator: 'StringEquals', key: 'aws:RequestedRegion', values: ['us-east-1'] },
          { operator: 'StringEquals', key: 'aws:RequestedRegion', values: ['eu-west-1'] },
        ],
      }),
    ]);

    expect(doc.Statement[0]?.Condition).toEqual({
      StringEquals: { 'aws:RequestedRegion': ['us-east-1', 'eu-west-1'] },
    });
  });
});

describe('statementLabel', () => {
  it('uses the sid when present and a positional fallback when not', () => {
    expect(statementLabel(statement({ sid: 'AllowGet' }), 0)).toContain('AllowGet');
    // Empty sid must still produce something addressable for the warnings list.
    expect(statementLabel(statement({ sid: '' }), 2)).not.toBe('');
  });
});

describe('newStatement', () => {
  it('ships a broad resource default that the warnings surface', () => {
    const created = newStatement(3);

    expect(created.effect).toBe('Allow');
    expect(created.sid).toBe('Statement4');
    expect(created.actions).toEqual(['s3:GetObject']);
    // `*` is the deliberate starting point for a new statement, so the editor must
    // flag it - otherwise a placeholder silently becomes an over-grant.
    expect(created.resources).toEqual(['*']);
    expect(hasWildcards(created)).toBe(true);
  });
});

describe('parseStatementsJson', () => {
  const canonical = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        sid: 'AllowGet',
        Effect: 'Allow',
        Action: ['s3:GetObject'],
        Resource: ['arn:aws:s3:::reports/monthly.csv'],
      },
    ],
  });

  it('accepts a full canonical policy document', () => {
    const result = parseStatementsJson(canonical);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a successful parse');
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]?.sid).toBe('AllowGet');
  });

  it('accepts a bare statement array', () => {
    const result = parseStatementsJson(
      JSON.stringify([
        {
          sid: 'Bare',
          effect: 'Allow',
          actions: ['s3:GetObject'],
          resources: ['arn:aws:s3:::reports/monthly.csv'],
          conditions: [],
        },
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a successful parse');
    expect(result.statements[0]?.sid).toBe('Bare');
  });

  it('rejects malformed JSON without throwing', () => {
    const result = parseStatementsJson('{ not json');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failed parse');
    expect(result.error).not.toBe('');
    expect(result.issues[0]?.path).toBe('$');
  });

  it('rejects a document with no Statement array', () => {
    const result = parseStatementsJson(JSON.stringify({ Version: '2012-10-17' }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failed parse');
    expect(result.error).toContain('Statement');
  });

  it('rejects an unknown effect via the shared schema', () => {
    const result = parseStatementsJson(
      JSON.stringify([
        {
          sid: 'Bad',
          effect: 'Maybe',
          actions: ['s3:GetObject'],
          resources: ['*'],
          conditions: [],
        },
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failed parse');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('surfaces a warning for a full wildcard grant', () => {
    const result = parseStatementsJson(
      JSON.stringify([
        { sid: 'AllowAll', effect: 'Allow', actions: ['*'], resources: ['*'], conditions: [] },
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a successful parse');
    expect(result.warnings.some((warning) => warning.includes('AllowAll'))).toBe(true);
  });
});
