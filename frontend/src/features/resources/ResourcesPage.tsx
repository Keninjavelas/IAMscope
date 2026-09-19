import { useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, Plus, Trash2 } from 'lucide-react';
import type { Resource } from '@iamscope/types';
import { useResources } from '@/api/queries/resources';
import { useDeleteResource } from '@/api/mutations/resources';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Table, type Column } from '@/components/ui/Table';
import { Toolbar, ToolbarSpacer } from '@/components/ui/Toolbar';
import { arnParts, formatCount, formatRelative, truncateArn } from '@/lib/format';
import { useActiveOrgId, useSessionStore } from '@/stores/session';
import { useCreateParam } from '@/hooks/useCreateParam';
import { ResourceFormDialog } from './components/ResourceFormDialog';
import { NoOrgNotice } from '@/features/orgs/components/NoOrgNotice';

export default function ResourcesPage(): JSX.Element {
  const orgId = useActiveOrgId();
  const canWrite = useSessionStore((state) => state.permissions.canWrite);
  const canAdmin = useSessionStore((state) => state.permissions.canAdmin);

  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';

  const resources = useResources(orgId, {
    ...(q === '' ? {} : { q }),
    ...(type === '' ? {} : { type }),
    includeDeleted: params.get('includeDeleted') === 'true',
    pageSize: 200,
  });
  const deleteResource = useDeleteResource();
  const createParam = useCreateParam(['resource'] as const);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);

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

  const columns = useMemo<Column<Resource>[]>(
    () => [
      {
        id: 'arn',
        header: 'Resource',
        minWidth: 280,
        accessor: (resource) => (
          <span className="flex min-w-0 flex-col">
            <span className="text-13 truncate text-text">
              {arnParts(resource.arn).resourceName || resource.arn}
            </span>
            <span className="mono text-micro break-all text-text-subtle" title={resource.arn}>
              {truncateArn(resource.arn, { max: 64 })}
            </span>
          </span>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        width: 130,
        accessor: (resource) => (
          <Badge variant="muted" hideIcon>
            {resource.type}
          </Badge>
        ),
      },
      {
        id: 'service',
        header: 'Service',
        width: 100,
        mono: true,
        accessor: (resource) => arnParts(resource.arn).service || '—',
      },
      {
        id: 'tags',
        header: 'Tags',
        width: 190,
        accessor: (resource) =>
          Object.keys(resource.tags).length === 0 ? (
            <span className="text-micro text-text-subtle">—</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {Object.entries(resource.tags)
                .slice(0, 2)
                .map(([key, value]) => (
                  <Badge key={key} variant="outline" hideIcon>
                    {key}={value}
                  </Badge>
                ))}
            </span>
          ),
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        width: 130,
        accessor: (resource) => (
          <span className="text-micro text-text-muted">{formatRelative(resource.updatedAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        width: 90,
        align: 'right',
        accessor: (resource) => (
          <span className="flex items-center justify-end gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={!canWrite}
              onClick={() => setEditing(resource)}
            >
              Edit
            </Button>
            <IconButton
              label={`Delete ${resource.arn}`}
              icon={Trash2}
              size="sm"
              disabled={!canAdmin || resource.deleted}
              onClick={() => deleteResource.mutate(resource.id)}
            />
          </span>
        ),
      },
    ],
    [canAdmin, canWrite, deleteResource],
  );

  if (orgId === null) return <NoOrgNotice />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Resources"
        description="The ARNs your policies and scenarios target. Registering resources makes the pickers smarter and the scenarios readable."
        breadcrumbs={[{ label: 'Workbench' }, { label: 'Resources' }]}
        actions={
          <Button
            variant="primary"
            size="sm"
            iconLeft={Plus}
            disabled={!canWrite}
            onClick={() => setFormOpen(true)}
          >
            New resource
          </Button>
        }
      />

      <Toolbar label="Resource filters">
        <Input
          data-search-input
          inputSize="sm"
          value={q}
          aria-label="Search resources"
          placeholder="Search ARN, type or tag…"
          wrapperClassName="w-[280px]"
          onChange={(event) => updateParam('q', event.target.value)}
        />
        <Input
          inputSize="sm"
          value={type}
          aria-label="Filter by type"
          placeholder="Type (S3Object)"
          wrapperClassName="w-[170px]"
          onChange={(event) => updateParam('type', event.target.value)}
        />
        <ToolbarSpacer>
          <span className="text-micro text-text-subtle" aria-live="polite">
            {resources.isLoading ? 'Loading…' : `${formatCount(resources.data?.total ?? 0)} total`}
          </span>
        </ToolbarSpacer>
      </Toolbar>

      {resources.isError ? (
        <div className="panel">
          <ErrorState error={resources.error} onRetry={() => void resources.refetch()} />
        </div>
      ) : (
        <Table
          className="max-h-[calc(100vh-260px)]"
          columns={columns}
          rows={resources.data?.items ?? []}
          getRowId={(resource) => resource.id}
          loading={resources.isLoading}
          emptyState={
            <EmptyState
              icon={Boxes}
              title={q === '' ? 'No resources yet' : 'No resource matches that filter'}
              description={
                q === ''
                  ? 'Register the buckets, tables, queues and roles your policies talk about. Wildcards still work, but named resources make evaluations readable.'
                  : 'Try a different search term or clear the type filter.'
              }
              action={
                q === '' ? (
                  <Button
                    variant="primary"
                    size="sm"
                    iconLeft={Plus}
                    disabled={!canWrite}
                    onClick={() => setFormOpen(true)}
                  >
                    New resource
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      updateParam('q', null);
                      updateParam('type', null);
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
          }
        />
      )}

      <ResourceFormDialog
        open={formOpen || createParam.requested === 'resource'}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) createParam.clear();
        }}
      />

      <ResourceFormDialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        resource={editing}
      />
    </div>
  );
}
