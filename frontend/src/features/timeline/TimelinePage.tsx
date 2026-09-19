import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, FileCode2, History, ScrollText, Users } from 'lucide-react';
import type { TimelineEventMarker } from '@iamscope/types';
import { roundToMinute, useTimelineDiff, useTimelineEvents, useTimelineState } from '@/api/queries';
import { DiffPreviewPanel } from '@/components/viz/DiffPreviewPanel';
import { TimelineScrubber } from '@/components/viz/TimelineScrubber';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, type Column } from '@/components/ui/Table';
import { ROUTES, policyRoutes } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { useActiveOrg, useActiveOrgId, useSessionReady } from '@/stores/session';

type StateTab = 'policies' | 'principals' | 'resources';

interface PolicyRow {
  id: string;
  name: string;
  arn: string;
  version: number;
  statements: number;
  deleted: boolean;
  mutatedAt: string | null;
}

interface PrincipalRow {
  id: string;
  name: string;
  arn: string;
  type: string;
  attached: number;
  groups: number;
  deleted: boolean;
}

interface ResourceRow {
  id: string;
  arn: string;
  type: string;
  deleted: boolean;
  mutatedAt: string | null;
}

const TABS: readonly { id: StateTab; label: string }[] = [
  { id: 'policies', label: 'Policies' },
  { id: 'principals', label: 'Principals' },
  { id: 'resources', label: 'Resources' },
];

/**
 * The Timeline lens (Plan §8.10, §12, §15.6).
 *
 * Scrubbing reconstructs the organization at any past minute. The requested
 * timestamp is rounded to the minute before it reaches the query so the server's
 * per-minute cache always hits.
 */
export default function TimelinePage(): JSX.Element {
  const orgId = useActiveOrgId();
  const org = useActiveOrg();
  const ready = useSessionReady();

  const max = useMemo(() => new Date().toISOString(), []);
  const fallbackMin = useMemo(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );
  /** The track runs from organization creation to now (Plan §15.6). */
  const min = org?.createdAt ?? fallbackMin;

  const [at, setAt] = useState<string>(roundToMinute(max));
  const [committedAt, setCommittedAt] = useState<string>(roundToMinute(max));
  const [tab, setTab] = useState<StateTab>('policies');
  const [filter, setFilter] = useState('');
  const [openMarker, setOpenMarker] = useState<TimelineEventMarker | null>(null);

  // Keep the scrubber pinned to "now" until the user moves it.
  useEffect(() => {
    setAt(roundToMinute(max));
    setCommittedAt(roundToMinute(max));
  }, [max]);

  const events = useTimelineEvents(orgId, min, max, { enabled: ready });
  const state = useTimelineState(orgId, committedAt, { enabled: ready });
  const diff = useTimelineDiff(orgId, committedAt, null, { enabled: ready });

  const markers = events.data?.events ?? [];

  /** Only the committed (minute-rounded) value is queried. */
  const commit = useCallback((next: string) => {
    setCommittedAt(roundToMinute(next));
  }, []);

  const policyRows = useMemo<PolicyRow[]>(
    () =>
      (state.data?.policies ?? []).map((policy) => ({
        id: policy.policyId,
        name: policy.name,
        arn: policy.arn,
        version: policy.version,
        statements: policy.statements.length,
        deleted: policy.deleted,
        mutatedAt: policy.mutatedAt,
      })),
    [state.data],
  );

  const principalRows = useMemo<PrincipalRow[]>(
    () =>
      (state.data?.principals ?? []).map((principal) => ({
        id: principal.principalId,
        name: principal.name,
        arn: principal.arn,
        type: principal.type,
        attached: principal.attachedPolicies.length,
        groups: principal.groupMemberships.length,
        deleted: principal.deleted,
      })),
    [state.data],
  );

  const resourceRows = useMemo<ResourceRow[]>(
    () =>
      (state.data?.resources ?? []).map((resource) => ({
        id: resource.resourceId,
        arn: resource.arn,
        type: resource.type,
        deleted: resource.deleted,
        mutatedAt: resource.mutatedAt,
      })),
    [state.data],
  );

  const needle = filter.trim().toLowerCase();
  const matches = useCallback(
    (values: readonly string[]): boolean =>
      needle === '' || values.some((value) => value.toLowerCase().includes(needle)),
    [needle],
  );

  const policyColumns = useMemo<readonly Column<PolicyRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Policy',
        minWidth: 200,
        accessor: (row) => (
          <Link to={policyRoutes.detail(row.id)} className="text-13 truncate no-underline">
            {row.name}
          </Link>
        ),
      },
      {
        id: 'arn',
        header: 'ARN',
        minWidth: 240,
        accessor: (row) => (
          <span className="mono text-12 truncate text-text-muted" title={row.arn}>
            {row.arn}
          </span>
        ),
      },
      {
        id: 'version',
        header: 'Version',
        width: 90,
        align: 'right',
        accessor: (row) => <span className="tabular">v{row.version}</span>,
      },
      {
        id: 'statements',
        header: 'Statements',
        width: 110,
        align: 'right',
        accessor: (row) => <span className="tabular">{row.statements}</span>,
      },
      {
        id: 'mutated',
        header: 'Last mutated',
        width: 160,
        accessor: (row) => (
          <span className="text-micro text-text-subtle">{formatDate(row.mutatedAt)}</span>
        ),
      },
    ],
    [],
  );

  const principalColumns = useMemo<readonly Column<PrincipalRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Principal',
        minWidth: 180,
        accessor: (row) => (
          <Link
            to={`/principals/${encodeURIComponent(row.id)}`}
            className="text-13 truncate no-underline"
          >
            {row.name}
          </Link>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        width: 90,
        accessor: (row) => (
          <Badge variant="muted" size="sm">
            {row.type}
          </Badge>
        ),
      },
      {
        id: 'arn',
        header: 'ARN',
        minWidth: 240,
        accessor: (row) => (
          <span className="mono text-12 truncate text-text-muted" title={row.arn}>
            {row.arn}
          </span>
        ),
      },
      {
        id: 'policies',
        header: 'Policies',
        width: 100,
        align: 'right',
        accessor: (row) => <span className="tabular">{row.attached}</span>,
      },
      {
        id: 'groups',
        header: 'Groups',
        width: 90,
        align: 'right',
        accessor: (row) => <span className="tabular">{row.groups}</span>,
      },
    ],
    [],
  );

  const resourceColumns = useMemo<readonly Column<ResourceRow>[]>(
    () => [
      {
        id: 'arn',
        header: 'Resource ARN',
        minWidth: 280,
        accessor: (row) => (
          <span className="mono text-12 truncate text-text" title={row.arn}>
            {row.arn}
          </span>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        width: 120,
        accessor: (row) => (
          <Badge variant="muted" size="sm">
            {row.type}
          </Badge>
        ),
      },
      {
        id: 'mutated',
        header: 'Last mutated',
        width: 160,
        accessor: (row) => (
          <span className="text-micro text-text-subtle">{formatDate(row.mutatedAt)}</span>
        ),
      },
    ],
    [],
  );

  const visiblePolicies = policyRows.filter((row) => matches([row.name, row.arn]));
  const visiblePrincipals = principalRows.filter((row) => matches([row.name, row.arn, row.type]));
  const visibleResources = resourceRows.filter((row) => matches([row.arn, row.type]));

  const counts = state.data?.counts;

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <PageHeader
        title="Timeline"
        description="Scrub through history and reconstruct the exact state of every policy, principal and resource at any past minute."
        actions={
          <span className="text-micro flex items-center gap-2 text-text-subtle">
            <Badge variant="muted" size="sm">
              at {formatDate(committedAt)}
            </Badge>
            {state.data === undefined ? null : (
              <Badge variant="muted" size="sm">
                {state.data.reconstructedFrom}
              </Badge>
            )}
          </span>
        }
      />

      {events.isError ? (
        <ErrorState
          error={events.error}
          title="Could not load timeline events"
          onRetry={() => void events.refetch()}
        />
      ) : (
        <TimelineScrubber
          min={min}
          max={max}
          value={at}
          markers={markers}
          loading={events.isLoading}
          onChange={setAt}
          onCommit={commit}
        />
      )}

      <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <DiffPreviewPanel preview={diff.data ?? null} loading={diff.isLoading} />

        <section className="panel flex flex-col gap-2 p-3" aria-label="Reconstructed state summary">
          <h2 className="text-13 font-medium text-text">At this moment</h2>
          {state.isLoading ? (
            <Skeleton variant="block" />
          ) : state.isError ? (
            <ErrorState error={state.error} compact onRetry={() => void state.refetch()} />
          ) : counts === undefined ? (
            <p className="text-12 text-text-subtle">State unavailable.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-micro flex items-center gap-1.5 text-text-subtle">
                  <FileCode2 aria-hidden="true" className="size-3" /> Policies
                </dt>
                <dd className="text-13 tabular text-text">{counts.policies}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-micro flex items-center gap-1.5 text-text-subtle">
                  <Users aria-hidden="true" className="size-3" /> Principals
                </dt>
                <dd className="text-13 tabular text-text">{counts.principals}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-micro flex items-center gap-1.5 text-text-subtle">
                  <Boxes aria-hidden="true" className="size-3" /> Resources
                </dt>
                <dd className="text-13 tabular text-text">{counts.resources}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-micro flex items-center gap-1.5 text-text-subtle">Deleted</dt>
                <dd className="text-13 tabular text-text">
                  {counts.deletedPolicies + counts.deletedPrincipals}
                </dd>
              </div>
            </dl>
          )}
          <p className="text-micro text-text-subtle">
            Reconstructed from policy versions and audit events, cached per minute on the server.
          </p>
        </section>
      </div>

      <section className="flex min-h-0 flex-col gap-2" aria-label="Reconstructed state">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Entity type" className="flex items-center gap-1">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
                className={
                  tab === entry.id
                    ? 'text-12 dur-fast rounded-input border border-accent bg-accent-subtle px-2 py-0.5 font-medium text-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
                    : 'text-12 dur-fast rounded-input border border-border-strong bg-bg-raised px-2 py-0.5 text-text-muted outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
                }
              >
                {entry.label}
                <span className="ml-1.5 tabular text-text-subtle">
                  {entry.id === 'policies'
                    ? policyRows.length
                    : entry.id === 'principals'
                      ? principalRows.length
                      : resourceRows.length}
                </span>
              </button>
            ))}
          </div>

          <div className="ml-auto w-56">
            <Input
              inputSize="sm"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter this state…"
              aria-label="Filter the reconstructed state"
            />
          </div>
        </div>

        {state.isLoading ? (
          <Skeleton variant="block" className="h-64" />
        ) : state.isError ? (
          <ErrorState
            error={state.error}
            title="Could not reconstruct this state"
            onRetry={() => void state.refetch()}
          />
        ) : (
          <>
            {tab === 'policies' ? (
              <Table
                columns={policyColumns}
                rows={visiblePolicies}
                getRowId={(row) => row.id}
                className="max-h-[60vh]"
                emptyState={
                  <EmptyState
                    compact
                    title="No policies at this moment"
                    description="Nothing matched the current filter, or no policy existed yet."
                  />
                }
              />
            ) : null}
            {tab === 'principals' ? (
              <Table
                columns={principalColumns}
                rows={visiblePrincipals}
                getRowId={(row) => row.id}
                className="max-h-[60vh]"
                emptyState={
                  <EmptyState
                    compact
                    title="No principals at this moment"
                    description="Nothing matched the current filter, or no principal existed yet."
                  />
                }
              />
            ) : null}
            {tab === 'resources' ? (
              <Table
                columns={resourceColumns}
                rows={visibleResources}
                getRowId={(row) => row.id}
                className="max-h-[60vh]"
                emptyState={
                  <EmptyState
                    compact
                    title="No resources at this moment"
                    description="Nothing matched the current filter, or no resource existed yet."
                  />
                }
              />
            ) : null}
          </>
        )}
      </section>

      <div className="flex items-center gap-2">
        <History aria-hidden="true" className="size-3.5 text-text-subtle" />
        <p className="text-micro text-text-subtle">
          Clicking a marker opens the audit detail for that event. The URL stays shareable: the
          scrubber value is rounded to the minute before it is queried.
        </p>
        <Link
          to={ROUTES.audit}
          className="text-micro dur-fast ml-auto inline-flex items-center gap-1 rounded-input no-underline outline-none hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ScrollText aria-hidden="true" className="size-3" />
          Audit log
        </Link>
      </div>

      <Drawer
        open={openMarker !== null}
        onOpenChange={(open) => {
          if (!open) setOpenMarker(null);
        }}
        title={openMarker === null ? 'Audit event' : openMarker.summary}
        description={
          openMarker === null
            ? undefined
            : `${formatDate(openMarker.timestamp)} · ${openMarker.actorEmail ?? 'system'}`
        }
        size="lg"
      >
        {openMarker === null ? null : (
          <div className="flex flex-col gap-3">
            <dl className="flex flex-wrap gap-x-4 gap-y-1">
              <div className="flex gap-1.5">
                <dt className="text-micro text-text-subtle">action</dt>
                <dd className="mono text-12 text-text">{openMarker.action}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-micro text-text-subtle">category</dt>
                <dd className="text-12 text-text">{openMarker.category}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-micro text-text-subtle">target</dt>
                <dd className="mono text-12 text-text">
                  {openMarker.targetType} · {openMarker.targetName}
                </dd>
              </div>
            </dl>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const next = roundToMinute(openMarker.timestamp);
                  setAt(next);
                  setCommittedAt(next);
                }}
              >
                Snap the scrubber here
              </Button>
              <Link
                to={`${ROUTES.audit}?targetId=${encodeURIComponent(openMarker.targetId)}`}
                className="text-12 dur-fast rounded-input no-underline outline-none hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Open in the audit log
              </Link>
            </div>

            <p className="text-micro text-text-subtle">
              Event id <span className="mono">{openMarker.id}</span> - the full before/after payload
              is available in the audit log for this target.
            </p>
          </div>
        )}
      </Drawer>
    </div>
  );
}
