import { useMemo, useState, type JSX } from 'react';
import { ChevronDown, ChevronRight, GitCompareArrows, Search } from 'lucide-react';
import type {
  EvaluationDiff,
  EvaluationDiffEntry,
  EvaluationOutcome,
  TraceEntry,
} from '@iamscope/types';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { HoverPreview } from '@/components/ui/Popover';
import { Input } from '@/components/ui/Input';
import { JsonDiff } from '@/components/ui/JsonDiff';
import { Table, type Column, type SortState } from '@/components/ui/Table';
import { cn } from '@/lib/cn';
import { truncateArn } from '@/lib/format';
import { ResultBadge } from './ResultBadge';
import { TracePanel } from './TracePanel';

export interface DiffTableProps {
  diff: EvaluationDiff;
  className?: string | undefined;
}

type TransitionKey = EvaluationDiffEntry['transition'];

type FilterKey = 'changed' | TransitionKey | 'all';

interface FilterChip {
  key: FilterKey;
  label: string;
  /** Security-relevant: everything else is secondary to a reduction in access. */
  tone: 'danger' | 'warn' | 'info' | 'muted';
  description: string;
}

/** "Reduced access" is first and loudest - it is the whole point of the lens. */
const CHIPS: readonly FilterChip[] = [
  {
    key: 'changed',
    label: 'All changes',
    tone: 'info',
    description: 'Every scenario whose decision moved, in either direction.',
  },
  {
    key: 'allow-to-deny',
    label: 'Reduced access',
    tone: 'danger',
    description:
      'Was allowed, now denied. Usually a deliberate tightening - confirm it was intended.',
  },
  {
    key: 'deny-to-allow',
    label: 'Broadened access',
    tone: 'warn',
    description: 'Was denied, now allowed. The security-relevant regression direction.',
  },
  {
    key: 'added',
    label: 'New scenario',
    tone: 'info',
    description: 'The scenario only exists in the newer run.',
  },
  {
    key: 'removed',
    label: 'Removed scenario',
    tone: 'muted',
    description: 'The scenario only exists in the older run.',
  },
  {
    key: 'unchanged',
    label: 'Unchanged',
    tone: 'muted',
    description: 'Same decision in both runs.',
  },
  {
    key: 'all',
    label: 'Everything',
    tone: 'muted',
    description: 'Ignore the transition filter entirely.',
  },
];

const TRANSITION_PRESENTATION: Record<
  TransitionKey,
  { label: string; variant: 'danger' | 'warn' | 'accent' | 'muted'; help: string }
> = {
  'allow-to-deny': {
    label: 'Reduced access',
    variant: 'danger',
    help: 'Allow before, Deny after.',
  },
  'deny-to-allow': {
    label: 'Broadened access',
    variant: 'warn',
    help: 'Deny before, Allow after.',
  },
  added: { label: 'Added', variant: 'accent', help: 'Only present in the newer run.' },
  removed: { label: 'Removed', variant: 'muted', help: 'Only present in the older run.' },
  unchanged: { label: 'Unchanged', variant: 'muted', help: 'Same decision in both runs.' },
};

function chipCount(diff: EvaluationDiff, key: FilterKey): number {
  if (key === 'all') return diff.counts.total;
  if (key === 'changed') return diff.counts.changed;
  if (key === 'allow-to-deny') return diff.counts.allowToDeny;
  if (key === 'deny-to-allow') return diff.counts.denyToAllow;
  if (key === 'added') return diff.counts.added;
  if (key === 'removed') return diff.counts.removed;
  return diff.counts.unchanged;
}

function matchesFilter(entry: EvaluationDiffEntry, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'changed') return entry.transition !== 'unchanged';
  return entry.transition === filter;
}

function entryHaystack(entry: EvaluationDiffEntry): string {
  return `${entry.scenarioName} ${entry.principalArn} ${entry.action} ${entry.resourceArn} ${entry.transition}`.toLowerCase();
}

function arnCell(arn: string, name: string): JSX.Element {
  return (
    <HoverPreview
      content={
        <div className="flex flex-col gap-1">
          <p className="text-13 font-medium text-text">{name}</p>
          <p className="mono text-micro break-all text-text-muted">{arn}</p>
        </div>
      }
    >
      <span className="arn" title={arn}>
        {truncateArn(arn)}
      </span>
    </HoverPreview>
  );
}

/**
 * The Impact lens table (Plan §8.8, §15.3).
 *
 * Rows are `EvaluationDiffEntry`. The table is virtualized by `Table` above the
 * shared threshold, and expanding a row opens a side-by-side explanation beneath
 * it: the before/after decision traces plus the statements that appeared or vanished.
 */
export function DiffTable({ diff, className }: DiffTableProps): JSX.Element {
  const [filter, setFilter] = useState<FilterKey>('changed');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState | null>({ id: 'severity', desc: true });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return diff.entries.filter(
      (entry) =>
        matchesFilter(entry, filter) && (needle === '' || entryHaystack(entry).includes(needle)),
    );
  }, [diff.entries, filter, query]);

  const rows = useMemo(() => {
    if (sort === null) return filtered;
    const direction = sort.desc ? -1 : 1;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort.id === 'scenario') return a.scenarioName.localeCompare(b.scenarioName) * direction;
      if (sort.id === 'action') return a.action.localeCompare(b.action) * direction;
      if (sort.id === 'transition') return a.transition.localeCompare(b.transition) * direction;
      // Default: security-relevant transitions float to the top.
      const rank = (entry: EvaluationDiffEntry): number => {
        if (entry.transition === 'deny-to-allow') return 3;
        if (entry.transition === 'allow-to-deny') return 2;
        if (entry.transition === 'unchanged') return 0;
        return 1;
      };
      return (rank(a) - rank(b)) * direction;
    });
    return sorted;
  }, [filtered, sort]);

  const columns = useMemo<readonly Column<EvaluationDiffEntry>[]>(
    () => [
      {
        id: 'scenario',
        header: 'Scenario',
        sortable: true,
        minWidth: 180,
        accessor: (entry) => (
          <span className="text-13 truncate text-text">{entry.scenarioName}</span>
        ),
      },
      {
        id: 'principal',
        header: 'Principal',
        minWidth: 200,
        accessor: (entry) => arnCell(entry.principalArn, 'Principal ARN'),
      },
      {
        id: 'action',
        header: 'Action',
        sortable: true,
        mono: true,
        minWidth: 150,
        accessor: (entry) => <span title={entry.action}>{entry.action}</span>,
      },
      {
        id: 'resource',
        header: 'Resource',
        minWidth: 200,
        accessor: (entry) => arnCell(entry.resourceArn, 'Resource ARN'),
      },
      {
        id: 'before',
        header: 'Before',
        width: 96,
        accessor: (entry) => <ResultBadge result={entry.before} size="sm" />,
      },
      {
        id: 'after',
        header: 'After',
        width: 96,
        accessor: (entry) => <ResultBadge result={entry.after} size="sm" />,
      },
      {
        id: 'transition',
        header: 'Transition',
        sortable: true,
        width: 150,
        accessor: (entry) => {
          const presentation = TRANSITION_PRESENTATION[entry.transition];
          return (
            <Badge variant={presentation.variant} size="sm" title={presentation.help}>
              {presentation.label}
            </Badge>
          );
        },
      },
    ],
    [],
  );

  const expanded = useMemo(
    () =>
      expandedId === null
        ? null
        : (diff.entries.find((entry) => entry.scenarioId === expandedId) ?? null),
    [diff.entries, expandedId],
  );

  return (
    <section className={cn('flex flex-col gap-2', className)} aria-label="Evaluation differences">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Filter by transition"
          className="flex flex-wrap items-center gap-1.5"
        >
          {CHIPS.map((chip) => {
            const active = filter === chip.key;
            const count = chipCount(diff, chip.key);
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={active}
                title={chip.description}
                onClick={() => setFilter(chip.key)}
                className={cn(
                  'dur-fast text-12 inline-flex items-center gap-1.5 rounded-input border px-2 py-0.5 font-medium outline-none transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  active
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-border-strong bg-bg-raised text-text-muted hover:bg-bg-hover hover:text-text',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    chip.tone === 'danger' && 'bg-severity-high',
                    chip.tone === 'warn' && 'bg-severity-medium',
                    chip.tone === 'info' && 'bg-severity-low',
                    chip.tone === 'muted' && 'bg-text-subtle',
                  )}
                />
                {chip.label}
                <span className="tabular text-text-subtle">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto w-56">
          <Input
            inputSize="sm"
            type="search"
            value={query}
            placeholder="Search scenarios, ARNs, actions…"
            aria-label="Search differences"
            prefix={<Search aria-hidden="true" className="size-3.5" />}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <p className="text-micro text-text-muted" aria-live="polite">
        {rows.length === diff.entries.length
          ? `${rows.length} scenarios`
          : `${rows.length} of ${diff.entries.length} scenarios`}
        {' · '}
        <span className="text-deny tabular">{diff.counts.denyToAllow} broadened</span>
        {' · '}
        <span className="text-diff-changed tabular">{diff.counts.allowToDeny} reduced</span>
      </p>

      <Table
        columns={columns}
        rows={rows}
        getRowId={(entry) => entry.scenarioId}
        sort={sort}
        onSortChange={setSort}
        stickyHeader
        className="max-h-[60vh]"
        rowActions={(entry) => {
          const isOpen = expandedId === entry.scenarioId;
          return (
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls="diff-entry-detail"
              aria-label={
                isOpen ? `Collapse ${entry.scenarioName}` : `Explain ${entry.scenarioName}`
              }
              onClick={() => setExpandedId(isOpen ? null : entry.scenarioId)}
              className="dur-fast inline-flex size-6 items-center justify-center rounded-input text-text-subtle outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {isOpen ? (
                <ChevronDown aria-hidden="true" className="size-3.5" />
              ) : (
                <ChevronRight aria-hidden="true" className="size-3.5" />
              )}
            </button>
          );
        }}
        emptyState={
          <EmptyState
            icon={GitCompareArrows}
            compact
            title={diff.entries.length === 0 ? 'No differences' : 'Nothing matches this filter'}
            description={
              diff.entries.length === 0
                ? 'The two runs produced identical decisions for every scenario in the organization.'
                : 'Clear the search box or pick a different transition chip to see the other rows.'
            }
            action={
              diff.entries.length === 0 ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setFilter('all');
                    setQuery('');
                  }}
                  className="text-13 dur-fast rounded-input px-1.5 py-0.5 text-accent outline-none hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Show everything
                </button>
              )
            }
          />
        }
      />

      {expanded === null ? null : (
        <div id="diff-entry-detail" className="panel flex flex-col gap-2 p-3">
          <header className="flex flex-wrap items-center gap-2">
            <h3 className="text-13 font-medium text-text">{expanded.scenarioName}</h3>
            <Badge variant="muted" size="sm">
              {TRANSITION_PRESENTATION[expanded.transition].help}
            </Badge>
            <span className="mono text-micro text-text-subtle">{expanded.action}</span>
            <button
              type="button"
              onClick={() => setExpandedId(null)}
              className="text-12 dur-fast ml-auto rounded-input px-1.5 py-0.5 text-text-muted outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Close explanation
            </button>
          </header>

          <DiffEntryDetail entry={expanded} />

          <JsonDiff
            mode="line"
            title="Statements added or removed"
            before={{ removed: expanded.removedStatements }}
            after={{ added: expanded.addedStatements }}
          />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Adapters used by the detail view                                    */
/* ------------------------------------------------------------------ */

/** Distinct policies contributing to a trace - folded into `evaluatedPolicies`. */
function countedPolicies(trace: readonly TraceEntry[]): number {
  return new Set(trace.map((entry) => entry.policyId)).size;
}

/**
 * Rebuild a single run's `EvaluationOutcome` from one side of a diff entry, so
 * the shared `TracePanel` can explain both sides without a second component.
 * `durationMs` is not carried on a stored trace, hence the zero.
 */
function traceOutcome(
  entry: EvaluationDiffEntry,
  side: 'before' | 'after',
): EvaluationOutcome | null {
  const trace = side === 'before' ? entry.beforeTrace : entry.afterTrace;
  const result = side === 'before' ? entry.before : entry.after;
  if (result === null && trace.length === 0) return null;

  const denied = trace.some((statement) => statement.effect === 'Deny');
  const reason: EvaluationOutcome['reason'] =
    trace.length === 0 ? 'implicit-deny' : denied ? 'explicit-deny' : 'explicit-allow';

  return {
    result: result ?? 'Deny',
    reason,
    trace,
    evaluatedPolicies: countedPolicies(trace),
    durationMs: 0,
    principalArn: entry.principalArn,
    action: entry.action,
    resourceArn: entry.resourceArn,
    boundaryPolicyId: null,
  };
}

function SideTrace({
  entry,
  side,
}: {
  entry: EvaluationDiffEntry;
  side: 'before' | 'after';
}): JSX.Element {
  const outcome = traceOutcome(entry, side);
  const heading = side === 'before' ? 'Before the change' : 'After the change';

  if (outcome === null) {
    return (
      <div className="inset-surface flex flex-col gap-1 p-3">
        <h4 className="text-12 font-medium text-text-muted">{heading}</h4>
        <p className="text-12 text-text-subtle">
          This scenario did not exist in that run, so there is no decision to explain.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-12 font-medium text-text-muted">{heading}</h4>
      <TracePanel outcome={outcome} />
    </div>
  );
}

function DiffEntryDetail({ entry }: { entry: EvaluationDiffEntry }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
      <SideTrace entry={entry} side="before" />
      <SideTrace entry={entry} side="after" />
    </div>
  );
}
