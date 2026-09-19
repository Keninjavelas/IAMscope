/**
 * Evaluation runs (Plan §10.7, §25 phase 8).
 *
 * Mutations enqueue a run which is debounced 500ms so a burst of edits produces one run.
 * The queue lives in-process; failures are logged and never propagate into the request path.
 */
import { ObjectId } from 'mongodb';
import type {
  EvaluationRunResult,
  EvaluationSummary,
  EvaluationTrigger,
  PolicyEffect,
} from '@iamscope/types';
import { data } from '../db/data';
import type { EvaluationRunDoc, ScenarioDoc } from '../db/documents';
import { logger } from '../logger';
import { oidRequired } from '../lib/objectId';
import { evaluateForOrg } from './evaluator';

export const EVALUATION_DEBOUNCE_MS = 500;

export interface EnqueueEvaluationInput {
  orgId: ObjectId;
  trigger: EvaluationTrigger | (string & {});
  triggeredByUserId?: ObjectId | null;
  causedByAuditEventId?: ObjectId | null;
  label?: string;
  delayMs?: number;
}

interface PendingEvaluation extends EnqueueEvaluationInput {
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingEvaluation>();

export function pendingEvaluationCount(): number {
  return pending.size;
}

/** Debounced enqueue. Safe to call from anywhere; never throws. */
export function enqueueEvaluation(input: EnqueueEvaluationInput): void {
  const key = oidRequired(input.orgId);
  const existing = pending.get(key);
  if (existing !== undefined) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pending.delete(key);
    void runEvaluationNow(input).catch((error: unknown) => {
      logger.error({ err: error, orgId: key }, 'background evaluation run failed');
    });
  }, input.delayMs ?? EVALUATION_DEBOUNCE_MS);

  // Do not hold the event loop open because of a debounce timer.
  timer.unref();

  pending.set(key, { ...input, timer });
}

export function cancelPendingEvaluations(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
}

export function buildSummary(results: readonly EvaluationRunResult[]): EvaluationSummary {
  const passed = results.filter((result) => result.passed).length;
  return { total: results.length, passed, failed: results.length - passed };
}

/** Evaluates a single scenario and shapes it as an `EvaluationRunResult`. */
export async function evaluateScenario(
  orgId: ObjectId,
  scenario: ScenarioDoc,
): Promise<EvaluationRunResult> {
  const outcome = await evaluateForOrg(orgId, {
    principalArn: scenario.principalArn,
    action: scenario.action,
    resourceArn: scenario.resourceArn,
  });

  return {
    scenarioId: oidRequired(scenario._id),
    scenarioName: scenario.name,
    principalArn: scenario.principalArn,
    action: scenario.action,
    resourceArn: scenario.resourceArn,
    expectedResult: scenario.expectedResult,
    result: outcome.result,
    passed: outcome.result === scenario.expectedResult,
    trace: outcome.trace,
    reason: outcome.reason,
  };
}

export interface RunEvaluationResult {
  run: EvaluationRunDoc;
  results: EvaluationRunResult[];
}

/** Runs every scenario in the org immediately and persists an `evaluation_runs` document. */
export async function runEvaluationNow(
  input: EnqueueEvaluationInput,
): Promise<RunEvaluationResult> {
  const orgId = input.orgId;
  const scenarios = await data.scenarios().find({ orgId }).sort({ name: 1 }).toArray();
  const snapshotAt = new Date();

  const results: EvaluationRunResult[] = [];
  for (const scenario of scenarios) {
    try {
      results.push(await evaluateScenario(orgId, scenario));
    } catch (error) {
      logger.error(
        { err: error, scenarioId: oidRequired(scenario._id) },
        'scenario evaluation failed',
      );
      results.push({
        scenarioId: oidRequired(scenario._id),
        scenarioName: scenario.name,
        principalArn: scenario.principalArn,
        action: scenario.action,
        resourceArn: scenario.resourceArn,
        expectedResult: scenario.expectedResult,
        result: 'Deny' satisfies PolicyEffect,
        passed: scenario.expectedResult === 'Deny',
        trace: [],
        reason: 'no-policy',
      });
    }
  }

  const summary = buildSummary(results);
  const doc: Omit<EvaluationRunDoc, '_id'> = {
    orgId,
    label: input.label ?? labelForTrigger(input.trigger, snapshotAt),
    snapshotAt,
    triggeredBy: input.trigger,
    triggeredByUserId: input.triggeredByUserId ?? null,
    causedByAuditEventId: input.causedByAuditEventId ?? null,
    results,
    summary,
    createdAt: new Date(),
  };

  const inserted = await data.evaluationRuns().insertOne(doc as EvaluationRunDoc);

  await Promise.all(
    results.map((result) =>
      data
        .scenarios()
        .updateOne(
          { _id: new ObjectId(result.scenarioId), orgId },
          { $set: { lastResult: result.result, lastRunAt: snapshotAt } },
        )
        .catch(() => undefined),
    ),
  );

  return { run: { ...doc, _id: inserted.insertedId }, results };
}

export function labelForTrigger(trigger: string, at: Date): string {
  const stamp = at.toISOString().replace('T', ' ').slice(0, 19);
  return `${trigger} @ ${stamp}`;
}

/** Reads the two most recent runs, used by the Impact lens default selection. */
export async function latestRuns(orgId: ObjectId, limit = 2): Promise<EvaluationRunDoc[]> {
  return data.evaluationRuns().find({ orgId }).sort({ snapshotAt: -1 }).limit(limit).toArray();
}
