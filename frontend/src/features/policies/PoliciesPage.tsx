import { useMemo, useState, type JSX } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileCode2, History, Plus, Trash2 } from 'lucide-react';
import type { Policy } from '@iamscope/types';
import { usePolicies } from '@/api/queries/policies';
import { useDeletePolicy } from '@/api/mutations/policies';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Table, type Column, type SortState } from '@/components/ui/Table';
import { Toolbar, ToolbarSpacer } from '@/components/ui/Toolbar';
import { countByEffect } from '@/lib/iam';
import { formatCount, formatRelative, truncateArn } from '@/lib/format';
import { policyRoutes } from '@/lib/constants';
import { useActiveOrgId, useSessionStore } from '@/stores/session';
import { useCreateParam } from '@/hooks/useCreateParam';
import { PolicyFormDialog } from './components/PolicyFormDialog';

const SORTABLE = new Set(['name', 'updatedAt', 'currentVersion']);

export default function PoliciesPage(): JSX.Element {
  const orgId = useActiveOrgId();
  const canWrite = useSessionStore((state) => state.permissions.canWrite);
  const canAdmin = useSessionStore((state) => state.permissions.canAdmin);

  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const tag = params.get('tag') ?? '';
  const includeDeleted = params.get('includeDeleted') === 'true';
  const sortParam = params.get('sort');
  const orderParam = params.get('order') === 'asc' ? 'asc' : 'desc';

  const sort: SortState | null =
    sortParam !== null && SORTABLE.has(sortParam)
      ? { id: sortParam, desc: orderParam === 'desc' }
      : null;

  // Built with conditional spreads: `exactOptionalPropertyTypes` forbids passing
  // an explicit `undefined` for an optional query field.
  const policies = usePolicies(orgId, {
    ...(q === '' ? {} : { q }),
    ...(tag === '' ? {} : { tag }),
    includeDeleted,
    ...(sort === null
      ? {}
      : { sort: sort.id, order: sort.desc ? ('desc' as const) : ('asc' as const) }),
    pageSize: 200,
  });

  const deletePolicy = useDeletePolicy();
  const createParam = useCreateParam(['policy'] as const);
  const [formOpen, setFormOpen] = useState(false);

  const openForm = formOpen || createParam.requested === 'policy';

  const updateParam = (key: string, value: string | null): void => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const columns = useMemo<Column<Policy>[]>(
    () => [
      {
        id: 'name',
        header: 'Policy',
        sortable: true,
        minWidth: 200,
        accessor: (policy) => (
          <span className="flex min-w-0 flex-col">
            <Link
              to={policyRoutes.detail(policy.id)}
              className="text-13 dur-fast truncate font-medium text-text no-underline hover:text-accent"
            >
              {policy.name}
            </Link>
            <span className="mono text-micro break-all text-text-subtle" title={policy.arn}>
              {truncateArn(policy.arn, { max: 56 })}
            </span>
          </span>
        ),
      },
      {
        id: 'statements',
        header: 'Statements',
        width: 150,
        accessor: (policy) => {
          const counts = countByEffect(policy.statements);
          return (
            <span className="flex items-center gap-1">
              <Badge variant="muted" hideIcon>
                {plural(policy.statements.length, 'statement')}
              </Badge>
              {counts.Allow > 0 ? (
                <Badge variant="allow" hideIcon>
                  {counts.Allow}
                </Badge>
              ) : null}
              {counts.Deny > 0 ? (
                <Badge variant="deny" hideIcon>
                  {counts.Deny}
                </Badge>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'currentVersion',
        header: 'Version',
        width: 90,
        sortable: true,
        align: 'right',
        mono: true,
        accessor: (policy) => `v${policy.currentVersion}`,
      },
      {
        id: 'tags',
        header: 'Tags',
        width: 200,
        accessor: (policy) => {
          const entries = Object.entries(policy.tags);
          if (entries.length === 0) return <span className="text-micro text-text-subtle">—</span>;
          return (
            <span className="flex flex-wrap items-center gap-1">
              {entries.slice(0, 2).map(([key, value]) => (
                <Badge key={key} variant="outline" hideIcon>
                  {key}={value}
                </Badge>
              ))}
              {entries.length > 2 ? (
                <Badge variant="muted" hideIcon>
                  +{entries.length - 2}
                </Badge>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        width: 140,
        sortable: true,
        accessor: (policy) => (
          <span className="text-micro text-text-muted">{formatRelative(policy.updatedAt)}</span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        width: 100,
        accessor: (policy) =>
          policy.deleted ? (
            <Badge variant="danger">Deleted</Badge>
          ) : (
            <Badge variant="success">Active</Badge>
          ),
      },
    ],
    [],
  );

  if (orgId === null) {
    return (
      <div className="panel">
        <EmptyState
          icon={FileCode2}
          title="No organization selected"
          description="Policies live inside an organization. Create one or switch to an existing one to continue."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link to="/orgs/new">Create organization</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Policies"
        description="Versioned IAM policies. Every save creates an immutable version, an audit event and a fresh evaluation run."
        breadcrumbs={[{ label: 'Workbench' }, { label: 'Policies' }]}
        actions={
          <Button
            variant="primary"
            size="sm"
            iconLeft={Plus}
            disabled={!canWrite}
            title={canWrite ? undefined : 'Your role is read-only'}
            onClick={() => setFormOpen(true)}
          >
            New policy
          </Button>
        }
      />

      <Toolbar label="Policy filters">
        <Input
          data-search-input
          inputSize="sm"
          value={q}
          onChange={(event) => updateParam('q', event.target.value)}
          placeholder="Search name or ARN…"
          aria-label="Search policies"
          wrapperClassName="w-[260px]"
        />
        <Input
          inputSize="sm"
          value={tag}
          onChange={(event) => updateParam('tag', event.target.value)}
          placeholder="tag=value"
          aria-label="Filter by tag"
          wrapperClassName="w-[160px]"
        />
        <label className="text-12 flex items-center gap-1.5 text-text-muted">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) =>
              updateParam('includeDeleted', event.target.checked ? 'true' : null)
            }
            className="size-3.5 accent-accent"
          />
          Show deleted
        </label>
        <ToolbarSpacer>
          <span className="text-micro text-text-subtle" aria-live="polite">
            {policies.isLoading ? 'Loading…' : `${formatCount(policies.data?.total ?? 0)} total`}
          </span>
        </ToolbarSpacer>
      </Toolbar>

      {policies.isError ? (
        <div className="panel">
          <ErrorState error={policies.error} onRetry={() => void policies.refetch()} />
        </div>
      ) : (
        <Table
          className="max-h-[calc(100vh-260px)]"
          columns={columns}
          rows={policies.data?.items ?? []}
          getRowId={(policy) => policy.id}
          loading={policies.isLoading}
          sort={sort}
          onSortChange={(next) => {
            if (next === null) {
              updateParam('sort', null);
              updateParam('order', null);
              return;
            }
            updateParam('sort', next.id);
            updateParam('order', next.desc ? 'desc' : 'asc');
          }}
          emptyState={
            <EmptyState
              icon={FileCode2}
              title={q === '' && tag === '' ? 'No policies yet' : 'No policy matches those filters'}
              description={
                q === '' && tag === ''
                  ? 'A policy is a named set of statements that allow or deny actions on resources. Create your first one to start evaluating decisions.'
                  : 'Try clearing the search or the tag filter.'
              }
              action={
                q === '' && tag === '' ? (
                  <Button
                    variant="primary"
                    size="sm"
                    iconLeft={Plus}
                    disabled={!canWrite}
                    onClick={() => setFormOpen(true)}
                  >
                    New policy
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      updateParam('q', null);
                      updateParam('tag', null);
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
          }
          rowActions={(policy) => (
            <span className="flex items-center justify-end gap-0.5">
              <Button size="sm" variant="ghost" asChild>
                <Link
                  to={policyRoutes.versions(policy.id)}
                  aria-label={`Version history for ${policy.name}`}
                  title={`Version history for ${policy.name}`}
                >
                  <History aria-hidden="true" className="size-4" />
                </Link>
              </Button>
              <IconButton
                label={`Delete ${policy.name}`}
                icon={Trash2}
                size="sm"
                disabled={!canAdmin || policy.deleted}
                onClick={() => deletePolicy.mutate(policy.id)}
              />
            </span>
          )}
        />
      )}

      <PolicyFormDialog
        open={openForm}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) createParam.clear();
        }}
      />

      {deletePolicy.error ? (
        <p role="alert" className="text-meta text-danger">
          {deletePolicy.error.message}
        </p>
      ) : null}
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
