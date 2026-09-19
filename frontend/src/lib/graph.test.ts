import { describe, expect, it } from 'vitest';
import type { EscalationHop, EscalationPath } from '@iamscope/types';
import {
  SEVERITY_ORDER,
  buildEscalationGraph,
  degreesByNode,
  edgeKindLabel,
  nodeColorVar,
  pathSignature,
  principalTypeFromArn,
  severityForHops,
  severityLabel,
  severityRank,
  worstSeverity,
} from './graph';

const ADMIN = 'arn:aws:iam::123456789012:role/AdminRole';
const AUDIT = 'arn:aws:iam::123456789012:role/SecurityAuditRole';
const ENGINEER = 'arn:aws:iam::123456789012:user/platform-engineer';

function hop(overrides: Partial<EscalationHop> = {}): EscalationHop {
  return {
    via: 'assume-role',
    target: AUDIT,
    targetName: 'SecurityAuditRole',
    policyId: null,
    policyName: null,
    sid: null,
    action: 'sts:AssumeRole',
    ...overrides,
  };
}

function path(overrides: Partial<EscalationPath> = {}): EscalationPath {
  return {
    id: 'path-1',
    orgId: 'org-1',
    pattern: 'assume-role-broader',
    fromPrincipalArn: ADMIN,
    fromPrincipalName: 'AdminRole',
    toPrincipalArn: AUDIT,
    toPrincipalName: 'SecurityAuditRole',
    hops: [hop()],
    severity: 'medium',
    computedAt: '2026-09-18T11:15:22.731Z',
    policySnapshotVersion: 1,
    ...overrides,
  };
}

describe('severity scale', () => {
  it('orders low < medium < high', () => {
    expect(SEVERITY_ORDER).toEqual(['low', 'medium', 'high']);
    expect(severityRank('low')).toBeLessThan(severityRank('medium'));
    expect(severityRank('medium')).toBeLessThan(severityRank('high'));
  });

  it('maps hop count to severity (Plan 11.3)', () => {
    expect(severityForHops(0)).toBe('low');
    expect(severityForHops(1)).toBe('low');
    expect(severityForHops(2)).toBe('medium');
    expect(severityForHops(3)).toBe('high');
    expect(severityForHops(9)).toBe('high');
  });

  it('picks the worse of two severities and treats null as absent', () => {
    expect(worstSeverity(null, 'high')).toBe('high');
    expect(worstSeverity('high', null)).toBe('high');
    expect(worstSeverity('low', 'medium')).toBe('medium');
    expect(worstSeverity('high', 'low')).toBe('high');
    expect(worstSeverity(null, null)).toBeNull();
  });

  it('labels every severity', () => {
    expect(severityLabel('low')).toBe('Low');
    expect(severityLabel('medium')).toBe('Medium');
    expect(severityLabel('high')).toBe('High');
  });
});

describe('principal classification', () => {
  it('derives the kind from the ARN', () => {
    expect(principalTypeFromArn(ADMIN)).toBe('Role');
    expect(principalTypeFromArn(ENGINEER)).toBe('User');
    expect(principalTypeFromArn('arn:aws:iam::123456789012:group/Admins')).toBe('Group');
    expect(principalTypeFromArn('arn:aws:s3:::bucket/key')).toBe('Resource');
  });

  it('colours nodes by kind, case-insensitively', () => {
    expect(nodeColorVar('Role')).toBe(nodeColorVar('ROLE'));
    expect(nodeColorVar('Group')).not.toBe(nodeColorVar('User'));
  });

  it('labels edge kinds', () => {
    const label = edgeKindLabel('assume-role');
    expect(typeof label).toBe('string');
    expect(label).not.toBe('');
  });
});

describe('pathSignature', () => {
  it('is stable for the same path and differs for another', () => {
    expect(pathSignature(path())).toBe(pathSignature(path()));

    const other = path({ toPrincipalArn: ENGINEER, toPrincipalName: 'platform-engineer' });
    expect(pathSignature(other)).not.toBe(pathSignature(path()));
  });
});

describe('buildEscalationGraph', () => {
  it('creates a node per principal and one edge per hop', () => {
    const payload = buildEscalationGraph([path()]);

    expect(payload.nodes.map((node) => node.id)).toEqual([ADMIN, AUDIT]);
    expect(payload.edges).toHaveLength(1);

    const edge = payload.edges[0];
    expect(edge?.source).toBe(ADMIN);
    expect(edge?.target).toBe(AUDIT);
    expect(edge?.kind).toBe('assume-role');
    expect(edge?.weight).toBe(1);
    expect(edge?.onEscalationPath).toBe(true);
  });

  it('falls back to the edge-kind label when the hop carries no policy name', () => {
    const payload = buildEscalationGraph([path()]);

    expect(payload.edges[0]?.label).toBe(edgeKindLabel('assume-role'));
  });

  it('prefers the hop policy name when present', () => {
    const payload = buildEscalationGraph([
      path({ hops: [hop({ policyName: 'AssumeRole-Broader' })] }),
    ]);

    expect(payload.edges[0]?.label).toBe('AssumeRole-Broader');
  });

  it('assigns hop depth from the position along the path', () => {
    const payload = buildEscalationGraph([
      path({ hops: [hop(), hop({ target: ENGINEER, targetName: 'platform-engineer' })] }),
    ]);

    const byId = new Map(payload.nodes.map((node) => [node.id, node]));
    expect(byId.get(ADMIN)?.hopDepth).toBe(0);
    expect(byId.get(AUDIT)?.hopDepth).toBe(1);
    expect(byId.get(ENGINEER)?.hopDepth).toBe(2);
  });

  it('merges a repeated edge and increases its weight', () => {
    const payload = buildEscalationGraph([path(), path({ id: 'path-2' })]);

    expect(payload.edges).toHaveLength(1);
    expect(payload.edges[0]?.weight).toBe(2);
  });

  it('keeps the worst severity and the shallowest depth when a node appears twice', () => {
    const payload = buildEscalationGraph([
      path({ severity: 'low' }),
      path({ id: 'path-2', severity: 'high' }),
    ]);

    const byId = new Map(payload.nodes.map((node) => [node.id, node]));
    expect(byId.get(ADMIN)?.severity).toBe('high');
    expect(byId.get(ADMIN)?.hopDepth).toBe(0);
  });

  it('orders nodes and edges deterministically', () => {
    const payload = buildEscalationGraph([path()]);

    expect(payload.nodes.map((node) => node.id)).toEqual(
      [...payload.nodes.map((node) => node.id)].sort((a, b) => a.localeCompare(b)),
    );
    expect(payload.edges.map((edge) => edge.id)).toEqual(
      [...payload.edges.map((edge) => edge.id)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('reports the newest computedAt across the paths', () => {
    const payload = buildEscalationGraph([
      path({ computedAt: '2026-09-18T11:00:00.000Z' }),
      path({ id: 'path-2', computedAt: '2026-09-18T12:30:00.000Z' }),
    ]);

    expect(payload.computedAt).toBe('2026-09-18T12:30:00.000Z');
  });

  it('passes the originating paths through unchanged', () => {
    const paths = [path()];
    const payload = buildEscalationGraph(paths);

    expect(payload.paths).toEqual(paths);
    expect(payload.truncated).toBe(false);
  });

  it('produces an empty graph with a timestamp for no paths', () => {
    const payload = buildEscalationGraph([]);

    expect(payload.nodes).toEqual([]);
    expect(payload.edges).toEqual([]);
    expect(payload.computedAt).not.toBe('');
  });
});

describe('degreesByNode', () => {
  it('counts incident edges per node', () => {
    const payload = buildEscalationGraph([path()]);
    const degrees = degreesByNode(payload);

    expect(degrees.get(ADMIN)).toBe(1);
    expect(degrees.get(AUDIT)).toBe(1);
  });
});
