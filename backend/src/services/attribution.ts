/**
 * Attribution (Plan §12.4): given a scenario whose evaluation verdict flipped between two runs,
 * rank the audit events that most likely caused it.
 */
import { ObjectId } from 'mongodb';
import type {
  AuditAttribution,
  AuditAttributionCause,
  EvaluationRunResult,
  PolicyEffect,
  TraceEntry,
} from '@iamscope/types';
import { data } from '../db/data';
import type { AuditEventDoc, EvaluationRunDoc } from '../db/documents';
import { notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';

const MUTATING_PREFIXES = ['policy.', 'principal.'] as const;

export interface AttributionHints {
  policyIds: ReadonlySet<string>;
  policyNames: ReadonlySet<string>;
  principalArns: ReadonlySet<string>;
  /** The window the events were drawn from, for proximity scoring. */
  windowStart: Date;
  windowEnd: Date;
}

export interface CauseScore {
  weight: number;
  rationale: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function proximity(event: AuditEventDoc, hints: AttributionHints): number {
  const span = Math.max(1, hints.windowEnd.getTime() - hints.windowStart.getTime());
  const offset = hints.windowEnd.getTime() - event.timestamp.getTime();
  return clamp01(1 - offset / span);
}

/**
 * Scores how strongly an audit event explains a scenario delta. Pure - unit tested without Mongo.
 * The weights are additive and clamped to 0..1.
 */
export function scoreAuditCause(event: AuditEventDoc, hints: AttributionHints): CauseScore {
  const reasons: string[] = [];
  let weight = 0;

  const touchesPolicy =
    hints.policyIds.has(event.target.id) || hints.policyNames.has(event.target.name);
  const touchesPrincipalArn = hints.principalArns.has(event.target.name);
  const isPrincipalTarget = event.target.type.toLowerCase() === 'principal';

  if (touchesPolicy) {
    weight += 0.5;
    reasons.push('touches a policy referenced by the evaluation trace');
  } else if (touchesPrincipalArn) {
    weight += 0.3;
    reasons.push('touches a principal involved in the scenario');
  } else if (isPrincipalTarget) {
    // Some principal changed, but not one the trace names.
    weight += 0.1;
    reasons.push('touches a principal');
  }

  // Only policy/principal mutations can move an evaluation verdict; an `apikey.create` must not
  // collect these bonuses just because its action also ends in `.create`.
  const isMutating = MUTATING_PREFIXES.some((prefix) => event.action.startsWith(prefix));
  if (isMutating) {
    weight += 0.2;
    reasons.push('is a policy or principal mutation');

    if (event.action.endsWith('.delete') || event.action.endsWith('.detach')) {
      weight += 0.15;
      reasons.push('removes permissions and can flip an Allow to a Deny');
    }

    if (
      event.action.endsWith('.attach') ||
      event.action.endsWith('.create') ||
      event.action.endsWith('.update')
    ) {
      weight += 0.1;
      reasons.push('grants or changes permissions');
    }
  }

  const closeness = proximity(event, hints);
  weight += 0.2 * closeness;
  if (closeness > 0.5) reasons.push('happened immediately before the later run');

  if (event.actorType === 'api_key') {
    weight += 0.05;
    reasons.push('was performed by an API key');
  }

  const finalWeight = Number(clamp01(weight).toFixed(4));
  const rationale =
    reasons.length === 0 ? 'No direct link to the scenario trace' : reasons.join('; ');

  return { weight: finalWeight, rationale };
}

export function confidenceBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

function changedFields(event: AuditEventDoc): string[] {
  if (event.before === null || event.after === null) return [];
  const keys = new Set([...Object.keys(event.before), ...Object.keys(event.after)]);
  const changed: string[] = [];
  for (const key of keys) {
    const before = JSON.stringify(event.before[key] ?? null);
    const after = JSON.stringify(event.after[key] ?? null);
    if (before !== after) changed.push(key);
  }
  return changed;
}

function traceHints(traces: readonly TraceEntry[][]): {
  policyIds: Set<string>;
  policyNames: Set<string>;
} {
  const policyIds = new Set<string>();
  const policyNames = new Set<string>();
  for (const trace of traces) {
    for (const entry of trace) {
      policyIds.add(entry.policyId);
      policyNames.add(entry.policyName);
    }
  }
  return { policyIds, policyNames };
}

function findScenarioResult(run: EvaluationRunDoc, scenarioId: string): EvaluationRunResult | null {
  return run.results.find((result) => result.scenarioId === scenarioId) ?? null;
}

export interface AttributionRequest {
  scenarioId: string;
  before?: string | undefined;
  after?: string | undefined;
}

async function loadRuns(
  orgId: ObjectId,
  request: AttributionRequest,
): Promise<{ before: EvaluationRunDoc; after: EvaluationRunDoc }> {
  const collection = data.evaluationRuns();

  const after =
    request.after === undefined
      ? (await collection.find({ orgId }).sort({ snapshotAt: -1 }).limit(1).toArray())[0]
      : await collection.findOne({ orgId, _id: new ObjectId(request.after) });

  if (after === undefined || after === null) throw notFound('Evaluation run not found');

  let before: EvaluationRunDoc | null = null;
  if (request.before !== undefined) {
    before = await collection.findOne({ orgId, _id: new ObjectId(request.before) });
  } else {
    const previous = await collection
      .find({ orgId, snapshotAt: { $lt: after.snapshotAt } })
      .sort({ snapshotAt: -1 })
      .limit(1)
      .toArray();
    before = previous[0] ?? null;
  }

  if (before === null) throw notFound('No earlier evaluation run to compare against');
  return { before, after };
}

export async function attribute(
  orgId: ObjectId,
  request: AttributionRequest,
): Promise<AuditAttribution> {
  const { before, after } = await loadRuns(orgId, request);
  const scenarioId = request.scenarioId;

  const beforeResult = findScenarioResult(before, scenarioId);
  const afterResult = findScenarioResult(after, scenarioId);

  if (afterResult === null) throw notFound('Scenario is not part of the later evaluation run');

  const scenarioName = afterResult.scenarioName;
  const resultBefore: PolicyEffect | null = beforeResult?.result ?? null;
  const resultAfter: PolicyEffect = afterResult.result;

  if (beforeResult !== null && beforeResult.result === afterResult.result) {
    return {
      scenarioId,
      scenarioName,
      before: oidRequired(before._id),
      after: oidRequired(after._id),
      resultBefore,
      resultAfter,
      causes: [],
      confidence: 'low',
      confidenceScore: 0,
      explanation: `The scenario evaluated to ${resultAfter} in both runs, so nothing changed.`,
    };
  }

  const { policyIds, policyNames } = traceHints([beforeResult?.trace ?? [], afterResult.trace]);
  const principalArns = new Set<string>([
    afterResult.principalArn,
    beforeResult?.principalArn ?? '',
  ]);
  principalArns.delete('');

  const windowStart = before.snapshotAt;
  const windowEnd = after.snapshotAt;

  const events = await data
    .auditEvents()
    .find({ orgId, timestamp: { $gt: windowStart, $lte: windowEnd } })
    .sort({ timestamp: 1 })
    .limit(1_000)
    .toArray();

  const hints: AttributionHints = { policyIds, policyNames, principalArns, windowStart, windowEnd };

  const candidates = events
    .filter((event) => event.target.type === 'policy' || event.target.type === 'principal')
    .map((event) => {
      const score = scoreAuditCause(event, hints);
      const cause: AuditAttributionCause = {
        auditEventId: oidRequired(event._id),
        timestamp: event.timestamp.toISOString(),
        action: event.action,
        actorEmail: event.actorEmail,
        target: { type: event.target.type, id: event.target.id, name: event.target.name },
        changedFields: changedFields(event),
        weight: score.weight,
        rationale: score.rationale,
      };
      return cause;
    })
    .filter((cause) => cause.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10);

  const top = candidates[0];
  const confidenceScore = top === undefined ? 0 : top.weight;

  let explanation: string;
  if (top === undefined) {
    explanation = `The scenario moved from ${resultBefore ?? 'not present'} to ${resultAfter}, but no audit event in the window explains it.`;
  } else {
    explanation =
      `${top.action} on ${top.target.type} "${top.target.name}" by ${top.actorEmail ?? 'system'} ` +
      `(${top.timestamp}) most likely explains ${resultBefore ?? 'the previous state'} -> ${resultAfter}.`;
  }

  return {
    scenarioId,
    scenarioName,
    before: oidRequired(before._id),
    after: oidRequired(after._id),
    resultBefore,
    resultAfter,
    causes: candidates,
    confidence: confidenceBand(confidenceScore),
    confidenceScore,
    explanation,
  };
}
