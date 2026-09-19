/**
 * Client-side IAM helpers (Plan §6 `lib/iam.ts`).
 *
 * Nothing here decides authorization - the engine on the server owns that
 * (Plan §10). This module exists so the *editor* can explain a statement to a
 * human: wildcards, effect, and JSON round-tripping on the canonical AWS shape.
 */
import { policyStatementSchema } from '@iamscope/schemas';
import {
  CONDITION_OPERATORS,
  POLICY_EFFECTS,
  type PolicyCondition,
  type PolicyEffect,
  type PolicyStatement,
} from '@iamscope/types';

/* ------------------------------------------------------------------ */
/* Wildcards                                                          */
/* ------------------------------------------------------------------ */

export function isWildcardAction(action: string): boolean {
  return action === '*' || action.includes('*') || action.includes('?');
}

export function isFullWildcardAction(action: string): boolean {
  return action.trim() === '*';
}

export function isWildcardResource(resource: string): boolean {
  return resource === '*' || resource.includes('*') || resource.includes('?');
}

export function isBroadWildcardArn(resource: string): boolean {
  // `arn:aws:s3:::*` or `arn:aws:s3:::bucket/*` - the classic over-grant.
  return resource.endsWith(':*') || resource.endsWith('/*');
}

export interface StatementWarnings {
  wildcardActions: string[];
  fullWildcard: boolean;
  wildcardResources: string[];
  broadResources: string[];
  missingResources: boolean;
  missingActions: boolean;
}

export function statementWarnings(statement: PolicyStatement): StatementWarnings {
  return {
    wildcardActions: statement.actions.filter(isWildcardAction),
    fullWildcard: statement.actions.some(isFullWildcardAction),
    wildcardResources: statement.resources.filter(isWildcardResource),
    broadResources: statement.resources.filter(isBroadWildcardArn),
    missingResources: statement.resources.length === 0,
    missingActions: statement.actions.length === 0,
  };
}

export function hasWildcards(statement: PolicyStatement): boolean {
  const warnings = statementWarnings(statement);
  return (
    warnings.wildcardActions.length > 0 ||
    warnings.wildcardResources.length > 0 ||
    warnings.fullWildcard
  );
}

/* ------------------------------------------------------------------ */
/* Effect                                                             */
/* ------------------------------------------------------------------ */

export interface EffectDescription {
  effect: PolicyEffect;
  label: 'Allow' | 'Deny';
  verb: 'Allows' | 'Denies';
  description: string;
  tone: 'allow' | 'deny';
  /** Explicit deny always beats allow (Plan §10.5). */
  overrides: boolean;
}

export function describeEffect(effect: PolicyEffect): EffectDescription {
  if (effect === 'Deny') {
    return {
      effect,
      label: 'Deny',
      verb: 'Denies',
      description: 'An explicit deny always wins, even if another statement allows the action.',
      tone: 'deny',
      overrides: true,
    };
  }
  return {
    effect,
    label: 'Allow',
    verb: 'Allows',
    description: 'Grants the action unless another statement explicitly denies it.',
    tone: 'allow',
    overrides: false,
  };
}

export function groupStatementsByEffect(statements: readonly PolicyStatement[]): {
  Allow: PolicyStatement[];
  Deny: PolicyStatement[];
} {
  const grouped: { Allow: PolicyStatement[]; Deny: PolicyStatement[] } = { Allow: [], Deny: [] };
  for (const statement of statements) grouped[statement.effect].push(statement);
  return grouped;
}

export function countByEffect(
  statements: readonly PolicyStatement[],
): Record<PolicyEffect, number> {
  const counts: Record<PolicyEffect, number> = { Allow: 0, Deny: 0 };
  for (const statement of statements) counts[statement.effect] += 1;
  return counts;
}

/* ------------------------------------------------------------------ */
/* Summaries                                                          */
/* ------------------------------------------------------------------ */

function summariseList(values: readonly string[], limit = 2): string {
  if (values.length === 0) return 'nothing';
  if (values.length <= limit) return values.join(', ');
  return `${values.slice(0, limit).join(', ')} +${values.length - limit} more`;
}

/** One-line, human-readable gist of a statement - used by the collapsed editor rows. */
export function summariseStatement(statement: PolicyStatement, index?: number): string {
  const description = describeEffect(statement.effect);
  const prefix = index === undefined ? '' : `${index + 1}. `;
  const actions = summariseList(statement.actions);
  const resources =
    statement.resources.length === 0
      ? 'no resources'
      : summariseList(statement.resources.map((resource) => (resource === '*' ? '*' : resource)));
  const conditions =
    statement.conditions.length === 0
      ? ''
      : ` when ${statement.conditions
          .map((condition) => `${condition.operator}(${condition.key})`)
          .join(' and ')}`;
  return `${prefix}${description.verb} ${actions} on ${resources}${conditions}`;
}

export function statementLabel(statement: PolicyStatement, index: number): string {
  return statement.sid.trim() === '' ? `Statement ${index + 1}` : statement.sid;
}

/* ------------------------------------------------------------------ */
/* Factory                                                            */
/* ------------------------------------------------------------------ */

export function newStatement(index = 0): PolicyStatement {
  return {
    sid: `Statement${index + 1}`,
    effect: 'Allow',
    actions: ['s3:GetObject'],
    resources: ['*'],
    conditions: [],
  };
}

export function newCondition(): PolicyCondition {
  return { operator: 'StringEquals', key: 'aws:RequestedRegion', values: ['us-east-1'] };
}

export const KNOWN_CONDITION_OPERATORS: readonly string[] = CONDITION_OPERATORS;
export const KNOWN_EFFECTS: readonly PolicyEffect[] = POLICY_EFFECTS;

/* ------------------------------------------------------------------ */
/* JSON serialisation (canonical AWS policy language)                 */
/* ------------------------------------------------------------------ */

function conditionsToDocument(
  conditions: readonly PolicyCondition[],
): Record<string, Record<string, string[]>> | undefined {
  if (conditions.length === 0) return undefined;
  const document: Record<string, Record<string, string[]>> = {};
  for (const condition of conditions) {
    const byOperator = document[condition.operator] ?? {};
    const existing = byOperator[condition.key] ?? [];
    byOperator[condition.key] = [...existing, ...condition.values];
    document[condition.operator] = byOperator;
  }
  return document;
}

export interface PolicyDocument {
  Version: string;
  Statement: Record<string, unknown>[];
}

export function statementsToDocument(statements: readonly PolicyStatement[]): PolicyDocument {
  return {
    Version: '2012-10-17',
    Statement: statements.map((statement) => {
      const conditions = conditionsToDocument(statement.conditions);
      return {
        ...(statement.sid.trim() === '' ? {} : { Sid: statement.sid }),
        Effect: statement.effect,
        Action:
          statement.actions.length === 1 ? (statement.actions[0] ?? '*') : [...statement.actions],
        Resource:
          statement.resources.length === 1
            ? (statement.resources[0] ?? '*')
            : [...statement.resources],
        ...(conditions === undefined ? {} : { Condition: conditions }),
      };
    }),
  };
}

/** Pretty-printed canonical policy document - the CodeMirror buffer. */
export function statementToJson(statements: readonly PolicyStatement[], space = 2): string {
  return JSON.stringify(statementsToDocument(statements), null, space);
}

/* ------------------------------------------------------------------ */
/* JSON parsing + validation                                          */
/* ------------------------------------------------------------------ */

export interface StatementIssue {
  path: string;
  message: string;
}

export type ParseStatementsResult =
  | { ok: true; statements: PolicyStatement[]; warnings: string[] }
  | { ok: false; error: string; issues: StatementIssue[] };

function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate;
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim() !== '') out.push(entry);
    }
    return out;
  }
  return [];
}

function normaliseEffect(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const lower = value.trim().toLowerCase();
  if (lower === 'allow') return 'Allow';
  if (lower === 'deny') return 'Deny';
  return value;
}

function normaliseConditions(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];

  // Internal shape: [{ operator, key, values }]
  if (Array.isArray(value)) {
    // `Array.isArray` narrows `unknown` to `any[]`; annotating the parameter keeps the
    // element type honest so the pass-through branch returns `unknown`, not `any`.
    return value.map((entry: unknown) => {
      if (entry === null || typeof entry !== 'object') return entry;
      const record = entry as Record<string, unknown>;
      return {
        operator: record.operator ?? record.Operator,
        key: record.key ?? record.Key,
        values: stringList(record.values ?? record.Values),
      };
    });
  }

  if (typeof value !== 'object') return [];

  // AWS shape: { Operator: { key: value | value[] } }
  const out: unknown[] = [];
  for (const [operator, byKey] of Object.entries(value as Record<string, unknown>)) {
    if (byKey === null || typeof byKey !== 'object' || Array.isArray(byKey)) continue;
    for (const [key, values] of Object.entries(byKey as Record<string, unknown>)) {
      out.push({ operator, key, values: stringList(values) });
    }
  }
  return out;
}

function normaliseStatement(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const record = raw as Record<string, unknown>;
  return {
    sid: firstString(record.sid, record.Sid) ?? '',
    effect: normaliseEffect(firstString(record.effect, record.Effect)),
    actions: stringList(record.actions ?? record.Action),
    resources: stringList(record.resources ?? record.Resource),
    conditions: normaliseConditions(record.conditions ?? record.Condition),
  };
}

function statementArrayFrom(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed as unknown[];
  if (parsed !== null && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.Statement)) return record.Statement as unknown[];
    if (Array.isArray(record.statements)) return record.statements as unknown[];
  }
  return null;
}

/**
 * Parse the editor buffer. Accepts either the full canonical document
 * (`{ Version, Statement: [...] }`), a bare array, or `{ statements: [...] }`,
 * then validates every statement with the shared zod schema so the client and
 * the API agree on what a legal statement is.
 */
export function parseStatementsJson(text: string): ParseStatementsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid JSON',
      issues: [{ path: '$', message: error instanceof Error ? error.message : 'Invalid JSON' }],
    };
  }

  const rawStatements = statementArrayFrom(parsed);
  if (rawStatements === null) {
    return {
      ok: false,
      error: 'Expected a policy document with a "Statement" array',
      issues: [{ path: '$', message: 'Expected a policy document with a "Statement" array' }],
    };
  }

  const normalised = rawStatements.map(normaliseStatement);
  const validated = policyStatementSchema.array().safeParse(normalised);
  if (!validated.success) {
    const issues: StatementIssue[] = validated.error.issues.map((issue) => ({
      path: issue.path.length === 0 ? '$' : issue.path.join('.'),
      message: issue.message,
    }));
    return { ok: false, error: issues[0]?.message ?? 'Validation failed', issues };
  }

  const statements: PolicyStatement[] = validated.data.map((statement) => ({
    sid: statement.sid,
    effect: statement.effect,
    actions: statement.actions,
    resources: statement.resources,
    conditions: statement.conditions.map((condition) => ({
      operator: condition.operator,
      key: condition.key,
      values: condition.values,
    })),
  }));

  const warnings: string[] = [];
  for (const [index, statement] of statements.entries()) {
    const found = statementWarnings(statement);
    if (found.fullWildcard) {
      warnings.push(`${statementLabel(statement, index)} grants every action ("*").`);
    }
    if (found.broadResources.length > 0) {
      warnings.push(
        `${statementLabel(statement, index)} applies to every resource in a namespace.`,
      );
    }
  }

  return { ok: true, statements, warnings };
}

/** Cheap lint used by the statement editor chips (no server round trip). */
export function lintStatement(statement: PolicyStatement): string[] {
  const found = statementWarnings(statement);
  const messages: string[] = [];
  if (found.missingActions) messages.push('Add at least one action.');
  if (found.missingResources) messages.push('Add at least one resource or the wildcard "*".');
  if (found.fullWildcard) messages.push('"*" grants every action in every service.');
  if (found.wildcardActions.length > 0 && !found.fullWildcard) {
    messages.push(
      `${found.wildcardActions.length} wildcard action pattern(s) - scope them if you can.`,
    );
  }
  if (found.broadResources.length > 0) {
    messages.push(`${found.broadResources.length} resource pattern(s) cover a whole namespace.`);
  }
  return messages;
}
