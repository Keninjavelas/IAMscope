import { useMemo, useState, type JSX } from 'react';
import {
  Ban,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Flag,
  ShieldQuestion,
} from 'lucide-react';
import type { EvaluationOutcome, TraceEntry } from '@iamscope/types';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDuration, truncateArn } from '@/lib/format';
import { describeEffect } from '@/lib/iam';
import { ResultBadge } from './ResultBadge';

export interface TracePanelProps {
  outcome: EvaluationOutcome | null;
  loading?: boolean | undefined;
  className?: string | undefined;
}

/* ------------------------------------------------------------------ */
/* Reason copy (Plan §10.5) - the engine's `reason` in plain language   */
/* ------------------------------------------------------------------ */

const REASON_TEXT: Record<EvaluationOutcome['reason'], string> = {
  'explicit-deny':
    'An explicit Deny statement matched. Explicit denies always win, whatever else allows.',
  'explicit-allow': 'An Allow statement matched, and nothing denied it.',
  'implicit-deny':
    'Nothing matched: no attached policy has a statement covering both this action and this resource.',
  'boundary-deny':
    "The principal's permission boundary denies this action, so it is denied regardless of the attached policies.",
  'no-policy':
    'No policy is attached to this principal (directly or through a group), so there is nothing to match.',
};

const SOURCE_LABEL: Record<TraceEntry['source'], string> = {
  principal: 'Attached to the principal',
  group: 'Inherited from a group',
  boundary: 'Permission boundary',
};

const SOURCE_BADGE: Record<TraceEntry['source'], 'accent' | 'info' | 'warn'> = {
  principal: 'accent',
  group: 'info',
  boundary: 'warn',
};

interface PolicyGroup {
  policyId: string;
  policyName: string;
  policyArn: string;
  entries: TraceEntry[];
  /** Worst effect in the group wins the summary badge. */
  effect: TraceEntry['effect'];
  sources: TraceEntry['source'][];
}

function groupByPolicy(trace: readonly TraceEntry[]): PolicyGroup[] {
  const groups = new Map<string, PolicyGroup>();
  for (const entry of trace) {
    const key = entry.policyId === '' ? entry.policyName : entry.policyId;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        policyId: entry.policyId,
        policyName: entry.policyName,
        policyArn: entry.policyArn,
        entries: [entry],
        effect: entry.effect,
        sources: [entry.source],
      });
      continue;
    }
    existing.entries.push(entry);
    if (entry.effect === 'Deny') existing.effect = 'Deny';
    if (!existing.sources.includes(entry.source)) existing.sources.push(entry.source);
  }
  return [...groups.values()];
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function Field({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="text-micro shrink-0 text-text-subtle">{label}</dt>
      <dd className={cn('min-w-0 truncate text-12 text-text', mono && 'mono')} title={value}>
        {value}
      </dd>
    </div>
  );
}

function Conditions({ entry }: { entry: TraceEntry }): JSX.Element {
  if (entry.matchedConditions.length === 0) {
    return <p className="text-micro text-text-subtle">No conditions on this statement.</p>;
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {entry.matchedConditions.map((condition, index) => (
        <li
          key={`${condition.operator}-${condition.key}-${index}`}
          className="flex min-w-0 items-center gap-1.5"
        >
          {condition.satisfied ? (
            <CircleCheck aria-hidden="true" className="size-3 shrink-0 text-allow" />
          ) : (
            <CircleX aria-hidden="true" className="size-3 shrink-0 text-deny" />
          )}
          <span className="sr-only">{condition.satisfied ? 'satisfied' : 'not satisfied'}</span>
          <span className="text-12 shrink-0 text-text-muted">
            {condition.satisfied ? 'met' : 'not met'}
          </span>
          <span className="text-micro mono min-w-0 truncate text-text-subtle">
            {condition.operator}({condition.key}) = {condition.expected.join(', ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatementRow({ entry, index }: { entry: TraceEntry; index: number }): JSX.Element {
  const effect = describeEffect(entry.effect);

  return (
    <li className="border-t border-border-subtle px-3 py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-micro w-5 shrink-0 text-right text-text-subtle tabular">
          {index + 1}
        </span>
        <ResultBadge result={entry.effect} size="sm" />
        <span className="text-12 font-medium text-text">
          {entry.sid.trim() === '' ? '(no Sid)' : entry.sid}
        </span>
        <Badge variant={SOURCE_BADGE[entry.source]} size="sm">
          {entry.source}
        </Badge>
        <span className="text-micro truncate text-text-subtle" title={SOURCE_LABEL[entry.source]}>
          {entry.sourceName}
        </span>
      </div>

      <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 pl-7 sm:grid-cols-2">
        <Field label="matched action" value={entry.matchedAction} />
        <Field label="matched resource" value={entry.matchedResource} />
      </dl>

      <div className="mt-1.5 pl-7">
        <Conditions entry={entry} />
      </div>

      <p className="text-micro mt-1.5 pl-7 text-text-subtle">{effect.description}</p>
    </li>
  );
}

function PolicyGroupCard({
  group,
  defaultOpen,
}: {
  group: PolicyGroup;
  defaultOpen: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `trace-policy-${group.policyId === '' ? group.policyName : group.policyId}`;

  return (
    <li className="inset-surface overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((previous) => !previous)}
        className="dur-fast flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
        )}
        <ResultBadge result={group.effect} size="sm" />
        <span
          className="min-w-0 flex-1 truncate text-13 font-medium text-text"
          title={group.policyArn}
        >
          {group.policyName}
        </span>
        <span className="text-micro shrink-0 text-text-subtle tabular">
          {group.entries.length === 1 ? '1 statement' : `${group.entries.length} statements`}
        </span>
        <Badge variant="muted" size="sm" className="shrink-0">
          {group.sources.join(' + ')}
        </Badge>
      </button>

      {open ? (
        <div id={panelId} className="border-t border-border-subtle">
          <p
            className="mono text-micro truncate px-3 pt-2 text-text-subtle"
            title={group.policyArn}
          >
            {group.policyArn}
          </p>
          <ol className="flex flex-col">
            {group.entries.map((entry, index) => (
              <StatementRow
                key={`${group.policyId}-${entry.sid}-${index}`}
                entry={entry}
                index={index}
              />
            ))}
          </ol>
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

/**
 * The decision path for a single evaluation (Plan §10.6, §15.4).
 *
 * Every matched statement is shown - not just the winner - because "why" is the
 * product. The verdict is announced assertively; colour is never the only signal.
 */
export function TracePanel({ outcome, loading = false, className }: TracePanelProps): JSX.Element {
  const groups = useMemo(() => (outcome === null ? [] : groupByPolicy(outcome.trace)), [outcome]);

  if (loading) {
    return (
      <section className={cn('panel flex flex-col gap-3 p-3', className)} aria-busy="true">
        <span className="sr-only" role="status">
          Evaluating
        </span>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton variant="block" />
      </section>
    );
  }

  if (outcome === null) {
    return (
      <section className={cn('panel', className)} aria-label="Decision trace">
        <EmptyState
          icon={ShieldQuestion}
          title="No evaluation yet"
          description="Run an evaluation and the full decision path appears here: which policies were loaded, which statements matched, and which conditions were satisfied."
        />
      </section>
    );
  }

  const allowed = outcome.result === 'Allow';
  const reason = REASON_TEXT[outcome.reason];
  const announcement = `${allowed ? 'Allowed' : 'Denied'}. ${reason}`;
  const boundaryGroups = groups.filter((group) => group.sources.includes('boundary'));

  return (
    <section
      className={cn('panel flex flex-col overflow-hidden', className)}
      aria-label="Decision trace"
    >
      {/* Verdict - assertive: an Allow/Deny is the one thing the user came for. */}
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className={cn(
          'flex flex-wrap items-center gap-3 border-b px-3 py-2',
          allowed ? 'border-allow/40 bg-success-subtle' : 'border-deny/40 bg-danger-subtle',
        )}
      >
        <span className="sr-only">{announcement}</span>
        <ResultBadge result={outcome.result} size="md" />
        {allowed ? (
          <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-allow" />
        ) : (
          <Ban aria-hidden="true" className="size-4 shrink-0 text-deny" />
        )}
        <p className="min-w-0 flex-1 text-13 text-text">{reason}</p>
        <Badge variant="muted" size="sm" className="shrink-0">
          {outcome.reason}
        </Badge>
      </div>

      <div className="flex flex-col gap-1 border-b border-border px-3 py-2">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          <Field label="principal" value={outcome.principalArn} />
          <Field label="action" value={outcome.action} />
          <Field label="resource" value={outcome.resourceArn} />
          <Field label="boundary" value={outcome.boundaryPolicyId ?? 'none'} />
        </dl>
        <p className="text-micro flex flex-wrap items-center gap-x-3 text-text-subtle">
          <span>
            <span className="tabular">{outcome.evaluatedPolicies}</span> policies evaluated
          </span>
          <span>
            <span className="tabular">{outcome.trace.length}</span> statements matched
          </span>
          <span>{formatDuration(outcome.durationMs)}</span>
        </p>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          compact
          icon={Flag}
          title="No matching statement"
          description={
            outcome.reason === 'no-policy'
              ? 'This principal has no policies attached, so the engine had nothing to match against.'
              : 'No statement in the attached policies covers both the requested action and the requested resource, so the result is an implicit deny.'
          }
        />
      ) : (
        <div className="flex min-h-0 flex-col overflow-auto">
          <ol className="flex flex-col gap-1.5 p-2">
            {groups.map((group, index) => (
              <PolicyGroupCard
                key={`${group.policyId}-${group.policyName}`}
                group={group}
                // Denies first and open by default: they decide the answer.
                defaultOpen={index === 0 || group.effect === 'Deny'}
              />
            ))}
          </ol>

          {boundaryGroups.length > 0 ? (
            <p className="text-micro border-t border-border px-3 py-2 text-text-subtle">
              Source order (Plan §10.2): principal → groups → boundary. The boundary evaluated here
              is <span className="mono">{truncateArn(outcome.boundaryPolicyId, { max: 60 })}</span>.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
