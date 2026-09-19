import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GitCompareArrows, Sparkles } from 'lucide-react';
import { useAttribution, useEvaluationDiff, useEvaluationRuns } from '@/api/queries';
import { DiffTable } from '@/components/domain/DiffTable';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useActiveOrgId, useSessionReady } from '@/stores/session';
import { AttributionPanel } from './components/AttributionPanel';

interface StatCard {
  key: string;
  label: string;
  value: number;
  hint: string;
  tone: 'danger' | 'warn' | 'muted' | 'info';
}

function StatCardView({ card }: { card: StatCard }): JSX.Element {
  return (
    <div className="panel flex flex-col gap-0.5 px-3 py-2">
      <span className="text-micro flex items-center gap-1.5 text-text-subtle">
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 rounded-full',
            card.tone === 'danger' && 'bg-severity-high',
            card.tone === 'warn' && 'bg-severity-medium',
            card.tone === 'info' && 'bg-severity-low',
            card.tone === 'muted' && 'bg-text-subtle',
          )}
        />
        {card.label}
      </span>
      <span className="text-20 tabular font-semibold text-text">{card.value}</span>
      <span className="text-micro text-text-muted">{card.hint}</span>
    </div>
  );
}

/**
 * The Impact lens (Plan §8.8, §12.4).
 *
 * Pick two evaluation runs and see, decision by decision, what moved. The table
 * opens on changed rows with "reduced access" surfaced first because that is the
 * direction a security review actually cares about.
 */
export default function ImpactPage(): JSX.Element {
  const orgId = useActiveOrgId();
  const ready = useSessionReady();
  const [params, setParams] = useSearchParams();

  const [before, setBefore] = useState<string | null>(params.get('before'));
  const [after, setAfter] = useState<string | null>(params.get('after'));
  const [attributionScenarioId, setAttributionScenarioId] = useState<string | null>(
    params.get('scenarioId'),
  );

  const runs = useEvaluationRuns(orgId, { pageSize: 25 }, { enabled: ready });

  // Memoised: the `?? []` literal is a fresh array on every render, which would make the
  // effect below re-run on every render.
  const runItems = useMemo(() => runs.data?.items ?? [], [runs.data]);

  // Default to the two most recent runs once the history arrives.
  useEffect(() => {
    if (runItems.length === 0) return;
    setAfter((previous) => {
      if (previous !== null && runItems.some((run) => run.id === previous)) return previous;
      return runItems[0]?.id ?? null;
    });
    setBefore((previous) => {
      if (previous !== null && runItems.some((run) => run.id === previous)) return previous;
      return runItems[1]?.id ?? null;
    });
  }, [runItems]);

  const diff = useEvaluationDiff(orgId, before, after, { enabled: ready });

  const attribution = useAttribution(orgId, attributionScenarioId, before, after, {
    enabled: ready,
  });

  const runOptions = useMemo(
    () =>
      runItems.map((run) => ({
        value: run.id,
        label: `${run.label === '' ? 'Unlabelled run' : run.label} · ${formatDate(run.snapshotAt, 'MMM d HH:mm')}`,
      })),
    [runItems],
  );

  const changedScenarios = useMemo(
    () => (diff.data?.entries ?? []).filter((entry) => entry.transition !== 'unchanged'),
    [diff.data],
  );

  const scenarioOptions = useMemo(
    () => [
      { value: '', label: 'No scenario selected' },
      ...changedScenarios.map((entry) => ({
        value: entry.scenarioId,
        label: `${entry.scenarioName} · ${entry.transition.replace(/-/g, ' ')}`,
      })),
    ],
    [changedScenarios],
  );

  /** Keep the URL in step so the view is shareable (Plan §17). */
  const syncParams = useCallback(
    (next: { before?: string | null; after?: string | null; scenarioId?: string | null }): void => {
      const merged = new URLSearchParams(params);
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === '') merged.delete(key);
        else merged.set(key, value);
      }
      setParams(merged, { replace: true });
    },
    [params, setParams],
  );

  const counts = diff.data?.counts;

  const cards: StatCard[] = [
    {
      key: 'reduced',
      label: 'Reduced access',
      value: counts?.allowToDeny ?? 0,
      hint: 'Allow before, Deny after - the intended direction.',
      tone: 'danger',
    },
    {
      key: 'broadened',
      label: 'Broadened access',
      value: counts?.denyToAllow ?? 0,
      hint: 'Deny before, Allow after - review these first.',
      tone: 'warn',
    },
    {
      key: 'changed',
      label: 'Rows changed',
      value: counts?.changed ?? 0,
      hint: 'Scenarios whose decision moved at all.',
      tone: 'info',
    },
    {
      key: 'total',
      label: 'Scenarios compared',
      value: counts?.total ?? 0,
      hint:
        counts === undefined
          ? 'Both runs are evaluated over every scenario.'
          : `${counts.unchanged} unchanged.`,
      tone: 'muted',
    },
  ];

  const notEnoughRuns = runs.data !== undefined && runItems.length < 2;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
      <PageHeader
        title="Impact"
        description="Diff two evaluation runs and read exactly which decisions moved, which statements appeared or vanished, and what caused it."
      />

      <section className="panel flex flex-wrap items-end gap-3 p-3" aria-label="Run selection">
        <div className="w-64">
          <Select
            label="Before"
            value={before ?? ''}
            onValueChange={(value) => {
              setBefore(value);
              syncParams({ before: value });
            }}
            options={
              before === null && runOptions.length > 0
                ? [{ value: '', label: 'Select a run' }, ...runOptions]
                : runOptions
            }
            placeholder="Older run"
            disabled={runOptions.length === 0}
          />
        </div>
        <div className="w-64">
          <Select
            label="After"
            value={after ?? ''}
            onValueChange={(value) => {
              setAfter(value);
              syncParams({ after: value });
            }}
            options={
              after === null && runOptions.length > 0
                ? [{ value: '', label: 'Select a run' }, ...runOptions]
                : runOptions
            }
            placeholder="Newer run"
            disabled={runOptions.length === 0}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pb-0.5">
          <Button
            variant="secondary"
            size="md"
            iconLeft={GitCompareArrows}
            disabled={runItems.length < 2}
            onClick={() => void diff.refetch()}
            loading={diff.isFetching}
          >
            Refresh diff
          </Button>
          {diff.data?.after === undefined ? null : (
            <span className="text-micro text-text-subtle">
              after: {formatRelative(diff.data.after.snapshotAt)}
            </span>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Diff summary">
        {cards.map((card) => (
          <StatCardView key={card.key} card={card} />
        ))}
      </section>

      <section className="panel flex flex-wrap items-end gap-3 p-3" aria-label="Attribution">
        <div className="w-80">
          <Select
            label="Attribute a delta to its cause"
            value={attributionScenarioId ?? ''}
            onValueChange={(value) => {
              const next = value === '' ? null : value;
              setAttributionScenarioId(next);
              syncParams({ scenarioId: next });
            }}
            options={scenarioOptions}
            placeholder={
              changedScenarios.length === 0 ? 'No changed scenarios' : 'Select a scenario'
            }
            disabled={changedScenarios.length === 0}
          />
        </div>
        <p className="text-micro flex items-center gap-1.5 pb-1.5 text-text-subtle">
          <Sparkles aria-hidden="true" className="size-3.5" />
          Uses every audit event recorded between the two runs.
        </p>
      </section>

      {attributionScenarioId === null ? null : (
        <AttributionPanel
          attribution={attribution.data ?? null}
          loading={attribution.isLoading || attribution.isFetching}
          {...(attribution.error === null ? {} : { error: attribution.error })}
          onRetry={() => void attribution.refetch()}
          onClear={() => {
            setAttributionScenarioId(null);
            syncParams({ scenarioId: null });
          }}
        />
      )}

      {runs.isLoading || (diff.isLoading && before !== null) ? (
        <Skeleton variant="block" className="h-64" />
      ) : runs.isError ? (
        <ErrorState
          error={runs.error}
          title="Could not load evaluation runs"
          onRetry={() => void runs.refetch()}
        />
      ) : notEnoughRuns ? (
        <section className="panel">
          <EmptyState
            icon={GitCompareArrows}
            title="Two runs are needed to diff"
            description="Every policy or principal change writes an evaluation run automatically. Make an edit, or evaluate a scenario twice, and the comparison appears here."
          />
        </section>
      ) : diff.isError ? (
        <ErrorState
          error={diff.error}
          title="Could not diff these runs"
          onRetry={() => void diff.refetch()}
        />
      ) : diff.data === undefined ? (
        <Skeleton variant="block" className="h-64" />
      ) : (
        <DiffTable diff={diff.data} />
      )}
    </div>
  );
}
