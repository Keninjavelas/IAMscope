import { useCallback, useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Activity, FlaskConical, Play, RotateCcw } from 'lucide-react';
import type {
  EvaluationOutcome,
  EvaluationRun,
  EvaluationRunResult,
  EvaluationRunSummary,
  Principal,
} from '@iamscope/types';
import { useEvaluationRun, useEvaluationRuns, usePrincipals } from '@/api/queries';
import { useEvaluate } from '@/api/mutations';
import { announceUrgent } from '@/components/app/ARIAAnnouncer';
import { TracePanel } from '@/components/domain/TracePanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { Kbd } from '@/components/ui/Kbd';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { ROUTES } from '@/lib/constants';
import { formatDate, formatRelative, truncateArn } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useActiveOrgId, useSessionReady } from '@/stores/session';

/** Suggestions for the action field - anything is accepted, these just speed it up. */
const ACTION_SUGGESTIONS: readonly string[] = [
  's3:GetObject',
  's3:PutObject',
  'iam:PassRole',
  'sts:AssumeRole',
  'iam:AttachRolePolicy',
  'iam:CreatePolicyVersion',
  'lambda:CreateFunction',
  'lambda:InvokeFunction',
  'ec2:RunInstances',
  'kms:Decrypt',
];

/**
 * Rebuild the `EvaluationOutcome` shape from a stored run result so one panel
 * explains both a fresh evaluation and a historical one.
 */
function outcomeFromResult(result: EvaluationRunResult): EvaluationOutcome {
  return {
    result: result.result,
    reason: result.reason,
    trace: result.trace,
    evaluatedPolicies: new Set(result.trace.map((entry) => entry.policyId)).size,
    durationMs: 0,
    principalArn: result.principalArn,
    action: result.action,
    resourceArn: result.resourceArn,
    boundaryPolicyId: null,
  };
}

/* ------------------------------------------------------------------ */
/* Run history                                                        */
/* ------------------------------------------------------------------ */

function RunHistoryRow({
  run,
  selected,
  onSelect,
}: {
  run: EvaluationRunSummary;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const failed = run.summary.failed;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'dur-fast flex w-full flex-col gap-0.5 rounded-input px-2 py-1.5 text-left outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          selected && 'bg-bg-selected',
        )}
      >
        <span className="text-12 flex items-center gap-1.5 text-text">
          <span className="min-w-0 flex-1 truncate">
            {run.label === '' ? 'Unlabelled run' : run.label}
          </span>
          {failed === 0 ? (
            <Badge variant="muted" size="sm">
              {run.summary.passed}/{run.summary.total} pass
            </Badge>
          ) : (
            <Badge variant="warn" size="sm">
              {failed} failing
            </Badge>
          )}
        </span>
        <span className="text-micro flex items-center gap-2 text-text-subtle">
          <span>{formatRelative(run.snapshotAt)}</span>
          <span className="truncate">{run.triggeredByName ?? run.triggeredBy}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * The Evaluate lens (Plan §8.8, §10, §15.4).
 *
 * One question, one answer, and the whole decision path behind it. Any role may
 * evaluate - the engine is read-only - so nothing here is gated on `canWrite`.
 */
export default function EvaluatePage(): JSX.Element {
  const orgId = useActiveOrgId();
  const ready = useSessionReady();

  const [principalArn, setPrincipalArn] = useState<string | null>(null);
  const [action, setAction] = useState('s3:GetObject');
  const [resourceArn, setResourceArn] = useState('*');
  const [persist, setPersist] = useState(true);
  const [label, setLabel] = useState('');
  const [outcome, setOutcome] = useState<EvaluationOutcome | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);

  const principals = usePrincipals(orgId, { pageSize: 200 }, { enabled: ready });
  const runs = useEvaluationRuns(orgId, { pageSize: 25 }, { enabled: ready });
  const selectedRun = useEvaluationRun(orgId, selectedRunId, { enabled: ready });
  const evaluate = useEvaluate();

  const principalItems = useMemo(
    () =>
      (principals.data?.items ?? []).map((principal: Principal) => ({
        value: principal.arn,
        label: principal.name,
        description: truncateArn(principal.arn, { max: 56 }),
        group: principal.type,
        keywords: [principal.arn, principal.type],
      })),
    [principals.data],
  );

  const submit = useCallback(async (): Promise<void> => {
    const target = principalArn ?? principalItems[0]?.value ?? null;
    if (target === null || action.trim() === '' || resourceArn.trim() === '') return;

    setSelectedRunId(null);
    const result = await evaluate.mutateAsync({
      principalArn: target,
      action: action.trim(),
      resourceArn: resourceArn.trim(),
      persist,
      ...(label.trim() === '' ? {} : { label: label.trim() }),
    });

    setOutcome(result);
    announceUrgent(
      `${result.result === 'Allow' ? 'Allowed' : 'Denied'}: ${result.action} on ${result.resourceArn}.`,
    );
    if (persist) setLabel('');
  }, [action, evaluate, label, persist, principalArn, principalItems, resourceArn]);

  const runPayload: EvaluationRun | null = selectedRun.data ?? null;
  const shownResults = runPayload?.results ?? [];
  const shownResult = selectedRunId === null ? null : (shownResults[selectedResultIndex] ?? null);

  const traceOutcome: EvaluationOutcome | null =
    shownResult !== null ? outcomeFromResult(shownResult) : outcome;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
      <PageHeader
        title="Evaluate"
        description="Ask the engine one question - can this principal perform this action on this resource? - and read the full decision path."
        actions={
          <Link
            to={ROUTES.scenarios}
            className="text-13 dur-fast inline-flex items-center gap-1.5 rounded-input text-text-muted no-underline outline-none hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <FlaskConical aria-hidden="true" className="size-3.5" />
            Scenarios
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="panel flex flex-col gap-3 p-3" aria-label="Evaluation input">
            <form
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void submit();
                }
              }}
            >
              <div className="sm:col-span-2">
                <Combobox
                  label="Principal"
                  value={principalArn}
                  onChange={setPrincipalArn}
                  items={principalItems}
                  allowClear
                  placeholder="Select a principal ARN"
                  searchPlaceholder="Search principals by name or ARN…"
                  emptyMessage="No principals match"
                />
                {principalArn === null ? (
                  <p className="text-micro mt-1 text-text-subtle">
                    Defaults to the first principal in the organization when left empty.
                  </p>
                ) : (
                  <p
                    className="mono text-micro mt-1 truncate text-text-subtle"
                    title={principalArn}
                  >
                    {principalArn}
                  </p>
                )}
              </div>

              <Input
                label="Action"
                value={action}
                onChange={(event) => setAction(event.target.value)}
                placeholder="s3:GetObject"
                className="mono"
                list="evaluate-action-suggestions"
                required
              />
              <datalist id="evaluate-action-suggestions">
                {ACTION_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>

              <Input
                label="Resource ARN"
                value={resourceArn}
                onChange={(event) => setResourceArn(event.target.value)}
                placeholder="arn:aws:s3:::bucket/*  or  *"
                className="mono"
                required
              />

              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-12 font-medium text-text-muted">Label (optional)</span>
                  <Input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="e.g. after tightening the bucket policy"
                    inputSize="md"
                    aria-label="Run label"
                  />
                </div>

                <label className="flex items-center gap-2 pb-1">
                  <input
                    type="checkbox"
                    checked={persist}
                    onChange={(event) => setPersist(event.target.checked)}
                    className="size-3.5 rounded-[3px] accent-[var(--accent)]"
                  />
                  <span className="text-12 text-text-muted">Save as a run</span>
                </label>
              </div>

              <div className="flex items-center gap-2 sm:col-span-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  iconLeft={Play}
                  loading={evaluate.isPending}
                  disabled={principalItems.length === 0}
                >
                  Evaluate
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  iconLeft={RotateCcw}
                  onClick={() => {
                    setOutcome(null);
                    setSelectedRunId(null);
                  }}
                >
                  Clear result
                </Button>
                <span className="text-micro ml-auto flex items-center gap-1 text-text-subtle">
                  <Kbd keys="mod+enter" />
                  to submit
                </span>
              </div>
            </form>

            {evaluate.isError ? (
              <ErrorState error={evaluate.error} compact title="Evaluation failed" />
            ) : null}
          </section>

          {principals.isError ? (
            <ErrorState
              error={principals.error}
              title="Could not load principals"
              onRetry={() => void principals.refetch()}
            />
          ) : null}

          {/* Assertive announcement for the verdict (Plan §15.4). */}
          <div role="status" aria-live="assertive" aria-atomic="true" className="sr-only">
            {traceOutcome === null
              ? ''
              : `Evaluation result ${traceOutcome.result}. ${traceOutcome.reason.replace(/-/g, ' ')}.`}
          </div>

          {selectedRunId !== null ? (
            <section className="panel flex flex-col gap-2 p-3" aria-label="Historical run">
              <header className="flex flex-wrap items-center gap-2">
                <h2 className="text-13 font-medium text-text">
                  {runPayload === null
                    ? 'Loading run…'
                    : runPayload.label === ''
                      ? 'Unlabelled run'
                      : runPayload.label}
                </h2>
                {runPayload === null ? null : (
                  <Badge variant="muted" size="sm">
                    {formatDate(runPayload.snapshotAt)}
                  </Badge>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRunId(null)}
                  className="text-12 dur-fast ml-auto rounded-input px-1.5 py-0.5 text-text-muted outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Back to live result
                </button>
              </header>

              {selectedRun.isLoading ? (
                <Skeleton variant="block" />
              ) : shownResults.length === 0 ? (
                <EmptyState compact title="This run recorded no scenarios" />
              ) : (
                <div className="flex flex-col gap-2">
                  <ul className="flex flex-wrap gap-1">
                    {shownResults.map((result, index) => (
                      <li key={`${result.scenarioId}-${index}`}>
                        <button
                          type="button"
                          onClick={() => setSelectedResultIndex(index)}
                          aria-pressed={index === selectedResultIndex}
                          className={cn(
                            'text-12 dur-fast rounded-input border px-2 py-0.5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                            index === selectedResultIndex
                              ? 'border-accent bg-accent-subtle text-accent'
                              : 'border-border-strong bg-bg-raised text-text-muted hover:bg-bg-hover hover:text-text',
                            result.passed ? '' : 'border-diff-changed',
                          )}
                        >
                          {result.scenarioName}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ) : null}

          <TracePanel outcome={traceOutcome} loading={evaluate.isPending} />
        </div>

        {/* Run history */}
        <aside
          className="panel flex max-h-[70vh] min-h-0 flex-col overflow-hidden"
          aria-label="Run history"
        >
          <header className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Activity aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
            <h2 className="text-13 font-medium text-text">Run history</h2>
            {runs.data === undefined ? null : (
              <span className="text-micro ml-auto tabular text-text-subtle">{runs.data.total}</span>
            )}
          </header>

          {runs.isLoading ? (
            <div className="flex flex-col gap-1 p-2">
              <Skeleton variant="row" />
              <Skeleton variant="row" />
              <Skeleton variant="row" />
            </div>
          ) : runs.isError ? (
            <ErrorState error={runs.error} compact onRetry={() => void runs.refetch()} />
          ) : (runs.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              compact
              icon={Activity}
              title="No runs yet"
              description="Evaluations saved with the toggle on appear here, newest first, so you can compare them in the Impact lens."
            />
          ) : (
            <ul className="flex min-h-0 flex-col overflow-auto p-1">
              {(runs.data?.items ?? []).map((run) => (
                <RunHistoryRow
                  key={run.id}
                  run={run}
                  selected={run.id === selectedRunId}
                  onSelect={() => {
                    setSelectedRunId(run.id);
                    setSelectedResultIndex(0);
                  }}
                />
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
