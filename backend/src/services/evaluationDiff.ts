/**
 * Impact lens diff (Plan §8.8, §12.4, §26 #5): compares two evaluation runs scenario by scenario
 * and classifies each transition. Pure function over the two run documents.
 */
import type {
  EvaluationDiff,
  EvaluationDiffEntry,
  EvaluationRun,
  EvaluationRunSummary,
  PolicyEffect,
  TraceEntry,
} from '@iamscope/types';
import type { EvaluationRunDoc } from '../db/documents';
import { oidRequired } from '../lib/objectId';
import { toEvaluationRunSummaryDTO } from '../lib/serialize';

export type DiffTransition = EvaluationDiffEntry['transition'];

/** Classifies a before/after verdict pair. */
export function classifyTransition(
  before: PolicyEffect | null,
  after: PolicyEffect | null,
): DiffTransition {
  if (before === null && after === null) return 'unchanged';
  if (before === null) return 'added';
  if (after === null) return 'removed';
  if (before === after) return 'unchanged';
  if (before === 'Allow' && after === 'Deny') return 'allow-to-deny';
  return 'deny-to-allow';
}

/** `policyId:sid` keys present in one trace but not the other. */
function statementKeySet(trace: readonly TraceEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of trace) keys.add(`${entry.policyId}:${entry.sid}`);
  return keys;
}

export function statementDelta(
  before: readonly TraceEntry[],
  after: readonly TraceEntry[],
): {
  removed: string[];
  added: string[];
} {
  const beforeKeys = statementKeySet(before);
  const afterKeys = statementKeySet(after);

  return {
    removed: [...beforeKeys].filter((key) => !afterKeys.has(key)).sort(),
    added: [...afterKeys].filter((key) => !beforeKeys.has(key)).sort(),
  };
}

export function summaryForRun(
  doc: EvaluationRunDoc,
  triggeredByName: string | null,
): EvaluationRunSummary {
  return toEvaluationRunSummaryDTO(doc, triggeredByName);
}

/**
 * Builds the full Impact-lens diff. `after` is required; `before` may be null, which reports the
 * first run as everything-added.
 */
export function diffEvaluations(
  before: EvaluationRunDoc | null,
  after: EvaluationRunDoc,
  names: { beforeName?: string | null; afterName?: string | null } = {},
): EvaluationDiff {
  const beforeById = new Map((before?.results ?? []).map((result) => [result.scenarioId, result]));
  const afterById = new Map(after.results.map((result) => [result.scenarioId, result]));
  const scenarioIds = new Set<string>([
    ...beforeById.keys(),
    ...afterById.keys(),
    ...after.results.map((r) => r.scenarioId),
  ]);

  const entries: EvaluationDiffEntry[] = [];

  for (const scenarioId of scenarioIds) {
    const beforeResult = beforeById.get(scenarioId);
    const afterResult = afterById.get(scenarioId);

    if (afterResult === undefined) {
      entries.push({
        scenarioId,
        scenarioName: beforeResult?.scenarioName ?? scenarioId,
        principalArn: beforeResult?.principalArn ?? '',
        action: beforeResult?.action ?? '',
        resourceArn: beforeResult?.resourceArn ?? '',
        before: beforeResult?.result ?? null,
        after: null,
        transition: 'removed',
        beforeTrace: beforeResult?.trace ?? [],
        afterTrace: [],
        removedStatements: statementDelta(beforeResult?.trace ?? [], []).removed,
        addedStatements: [],
      });
      continue;
    }

    const transition = classifyTransition(beforeResult?.result ?? null, afterResult.result);
    const delta = statementDelta(beforeResult?.trace ?? [], afterResult.trace);

    entries.push({
      scenarioId,
      scenarioName: afterResult.scenarioName,
      principalArn: afterResult.principalArn,
      action: afterResult.action,
      resourceArn: afterResult.resourceArn,
      before: beforeResult?.result ?? null,
      after: afterResult.result,
      transition,
      beforeTrace: beforeResult?.trace ?? [],
      afterTrace: afterResult.trace,
      removedStatements: delta.removed,
      addedStatements: delta.added,
    });
  }

  const counts = {
    total: entries.length,
    changed: entries.filter((entry) => entry.transition !== 'unchanged').length,
    allowToDeny: entries.filter((entry) => entry.transition === 'allow-to-deny').length,
    denyToAllow: entries.filter((entry) => entry.transition === 'deny-to-allow').length,
    unchanged: entries.filter((entry) => entry.transition === 'unchanged').length,
    added: entries.filter((entry) => entry.transition === 'added').length,
    removed: entries.filter((entry) => entry.transition === 'removed').length,
  };

  return {
    before: before === null ? null : summaryForRun(before, names.beforeName ?? null),
    after: summaryForRun(after, names.afterName ?? null),
    counts,
    entries: entries.sort((a, b) => a.scenarioName.localeCompare(b.scenarioName)),
  };
}

export function runId(run: EvaluationRunDoc): string {
  return oidRequired(run._id);
}

export type { EvaluationRun };
