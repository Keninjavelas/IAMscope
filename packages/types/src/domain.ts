/**
 * `iamscope_data` domain wire types: policies, versions, principals, resources, scenarios.
 */

/* ------------------------------------------------------------------ */
/* Policy statements                                                   */
/* ------------------------------------------------------------------ */

export const POLICY_EFFECTS = ['Allow', 'Deny'] as const;
export type PolicyEffect = (typeof POLICY_EFFECTS)[number];

/**
 * Condition operators. v1 evaluates the first three; the rest are accepted by the
 * schema so v2 can enforce them without a migration.
 */
export const CONDITION_OPERATORS = [
  'StringEquals',
  'StringLike',
  'ArnLike',
  'StringNotEquals',
  'ArnEquals',
  'Bool',
  'IpAddress',
  'NotIpAddress',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const V1_CONDITION_OPERATORS: readonly ConditionOperator[] = [
  'StringEquals',
  'StringLike',
  'ArnLike',
];

export interface PolicyCondition {
  operator: ConditionOperator;
  key: string;
  values: string[];
}

export interface PolicyStatement {
  sid: string;
  effect: PolicyEffect;
  actions: string[];
  resources: string[];
  conditions: PolicyCondition[];
}

export interface Policy {
  id: string;
  orgId: string;
  name: string;
  arn: string;
  currentVersion: number;
  statements: PolicyStatement[];
  tags: Record<string, string>;
  deleted: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyVersion {
  id: string;
  orgId: string;
  policyId: string;
  version: number;
  statements: PolicyStatement[];
  changedBy: string;
  changedByName?: string;
  changeReason: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Principals                                                          */
/* ------------------------------------------------------------------ */

export const PRINCIPAL_TYPES = ['User', 'Role', 'Group'] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export interface Principal {
  id: string;
  orgId: string;
  type: PrincipalType;
  name: string;
  arn: string;
  attachedPolicies: string[];
  /** For principals of type `User`: the group names/ARNs they belong to. */
  groupMemberships: string[];
  /** ARNs this principal can `sts:AssumeRole` into. */
  assumeRoleTargets: string[];
  boundaryPolicyId: string | null;
  tags: Record<string, string>;
  deleted: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PrincipalDetail extends Principal {
  /** Hydrated policies for the detail view. */
  attachedPolicySummaries: PolicySummary[];
  memberNames: string[];
  escalationIn: EscalationLink[];
  escalationOut: EscalationLink[];
}

export interface PolicySummary {
  id: string;
  name: string;
  arn: string;
  currentVersion: number;
}

export interface EscalationLink {
  principalId: string;
  principalArn: string;
  principalName: string;
  severity: 'low' | 'medium' | 'high';
}

/* ------------------------------------------------------------------ */
/* Resources                                                           */
/* ------------------------------------------------------------------ */

export interface Resource {
  id: string;
  orgId: string;
  arn: string;
  type: string;
  tags: Record<string, string>;
  accountId: string | null;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

export interface Scenario {
  id: string;
  orgId: string;
  name: string;
  principalArn: string;
  action: string;
  resourceArn: string;
  expectedResult: PolicyEffect;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioWithResult extends Scenario {
  lastResult: PolicyEffect | null;
  lastRunAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Route payloads                                                      */
/* ------------------------------------------------------------------ */

export interface CreatePolicyPayload {
  name: string;
  statements: PolicyStatement[];
  tags?: Record<string, string>;
  changeReason: string;
}

export interface UpdatePolicyPayload {
  statements: PolicyStatement[];
  changeReason: string;
  tags?: Record<string, string>;
}

export interface RestorePolicyPayload {
  version: number;
  changeReason?: string;
}

export interface CreatePrincipalPayload {
  type: PrincipalType;
  name: string;
  arn: string;
  attachedPolicies?: string[];
  groupMemberships?: string[];
  assumeRoleTargets?: string[];
  boundaryPolicyId?: string | null;
  tags?: Record<string, string>;
}

export interface UpdatePrincipalPayload {
  type?: PrincipalType;
  name?: string;
  arn?: string;
  attachedPolicies?: string[];
  groupMemberships?: string[];
  assumeRoleTargets?: string[];
  boundaryPolicyId?: string | null;
  tags?: Record<string, string>;
}

export interface CreateResourcePayload {
  arn: string;
  type: string;
  tags?: Record<string, string>;
  accountId?: string | null;
}

export interface UpdateResourcePayload {
  arn?: string;
  type?: string;
  tags?: Record<string, string>;
  accountId?: string | null;
}

export interface CreateScenarioPayload {
  name: string;
  principalArn: string;
  action: string;
  resourceArn: string;
  expectedResult: PolicyEffect;
  tags?: string[];
}

export interface UpdateScenarioPayload {
  name?: string;
  principalArn?: string;
  action?: string;
  resourceArn?: string;
  expectedResult?: PolicyEffect;
  tags?: string[];
}

export interface ListQuery {
  includeDeleted?: boolean;
  tag?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface ListScenariosQuery extends ListQuery {
  tags?: string[];
  principalArn?: string;
}
