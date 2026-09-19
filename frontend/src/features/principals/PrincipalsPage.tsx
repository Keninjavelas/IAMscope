import { useMemo, useState, type JSX } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Users } from 'lucide-react';
import { PRINCIPAL_TYPES, type Principal, type PrincipalType } from '@iamscope/types';
import { usePrincipals } from '@/api/queries/principals';
import { useDeletePrincipal } from '@/api/mutations/principals';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Table, type Column } from '@/components/ui/Table';
import { Toolbar, ToolbarSpacer } from '@/components/ui/Toolbar';
import { formatCount, formatRelative, truncateArn } from '@/lib/format';
import { principalRoutes } from '@/lib/constants';
import { useActiveOrgId, useSessionStore } from '@/stores/session';
import { useCreateParam } from '@/hooks/useCreateParam';
import { PrincipalFormDialog } from './components/PrincipalFormDialog';
import { NoOrgNotice } from '@/features/orgs/components/NoOrgNotice';

const TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All types' },
  ...PRINCIPAL_TYPES.map((type) => ({ value: type, label: type })),
];

export default function PrincipalsPage(): JSX.Element {
  const orgId = useActiveOrgId();
  const canWrite = useSessionStore((state) => state.permissions.canWrite);
  const canAdmin = useSessionStore((state) => state.permissions.canAdmin);

  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';

  const principals = usePrincipals(orgId, {
    ...(q === '' ? {} : { q }),
    ...(type === '' ? {} : { type: type as PrincipalType }),
    pageSize: 200,
  });
  const deletePrincipal = useDeletePrincipal();
  const createParam = useCreateParam(['principal'] as const);
  const [formOpen, setFormOpen] = useState(false);

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

  const columns = useMemo<Column<Principal>[]>(
    () => [
      {
        id: 'name',
        header: 'Principal',
        minWidth: 240,
        accessor: (principal) => (
          <span className="flex min-w-0 flex-col">
            <Link
              to={principalRoutes.detail(principal.id)}
              className="text-13 dur-fast truncate font-medium text-text no-underline hover:text-accent"
            >
              {principal.name}
            </Link>
            <span className="mono text-micro break-all text-text-subtle" title={principal.arn}>
              {truncateArn(principal.arn, { max: 64 })}
            </span>
          </span>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        width: 90,
        accessor: (principal) => (
          <Badge
            variant={
              principal.type === 'Role' ? 'accent' : principal.type === 'User' ? 'info' : 'muted'
            }
            hideIcon
          >
            {principal.type}
          </Badge>
        ),
      },
      {
        id: 'policies',
        header: 'Policies',
        width: 100,
        align: 'right',
        mono: true,
        accessor: (principal) => principal.attachedPolicies.length,
      },
      {
        id: 'assume',
        header: 'Assume targets',
        width: 140,
        align: 'right',
        mono: true,
        accessor: (principal) => principal.assumeRoleTargets.length,
      },
      {
        id: 'tags',
        header: 'Tags',
        width: 180,
        accessor: (principal) =>
          Object.keys(principal.tags).length === 0 ? (
            <span className="text-micro text-text-subtle">—</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {Object.entries(principal.tags)
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
        accessor: (principal) => (
          <span className="text-micro text-text-muted">{formatRelative(principal.updatedAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        width: 56,
        align: 'right',
        accessor: (principal) => (
          <IconButton
            label={`Delete ${principal.name}`}
            icon={Trash2}
            size="sm"
            disabled={!canAdmin || principal.deleted}
            onClick={() => deletePrincipal.mutate(principal.id)}
          />
        ),
      },
    ],
    [canAdmin, deletePrincipal],
  );

  if (orgId === null) return <NoOrgNotice />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Principals"
        description="Users, roles and groups that carry policies. The attached policies plus the assume-role targets are what the escalation graph walks."
        breadcrumbs={[{ label: 'Workbench' }, { label: 'Principals' }]}
        actions={
          <Button
            variant="primary"
            size="sm"
            iconLeft={Plus}
            disabled={!canWrite}
            onClick={() => setFormOpen(true)}
          >
            New principal
          </Button>
        }
      />

      <Toolbar label="Principal filters">
        <Input
          data-search-input
          inputSize="sm"
          value={q}
          aria-label="Search principals"
          placeholder="Search name, ARN or tag…"
          wrapperClassName="w-[260px]"
          onChange={(event) => updateParam('q', event.target.value)}
        />
        <Select
          size="sm"
          ariaLabel="Filter by type"
          className="w-[150px]"
          value={type}
          options={TYPE_FILTER_OPTIONS}
          onValueChange={(value) => updateParam('type', value)}
        />
        <ToolbarSpacer>
          <span className="text-micro text-text-subtle" aria-live="polite">
            {principals.isLoading
              ? 'Loading…'
              : `${formatCount(principals.data?.total ?? 0)} total`}
          </span>
        </ToolbarSpacer>
      </Toolbar>

      {principals.isError ? (
        <div className="panel">
          <ErrorState error={principals.error} onRetry={() => void principals.refetch()} />
        </div>
      ) : (
        <Table
          className="max-h-[calc(100vh-260px)]"
          columns={columns}
          rows={principals.data?.items ?? []}
          getRowId={(principal) => principal.id}
          loading={principals.isLoading}
          emptyState={
            <EmptyState
              icon={Users}
              title={q === '' ? 'No principals yet' : 'No principal matches that filter'}
              description={
                q === ''
                  ? 'Add the IAM users, roles and groups you care about. Attaching a policy to a principal is what makes an escalation path possible.'
                  : 'Try a different search or type filter.'
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
                    New principal
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => updateParam('q', null)}>
                    Clear search
                  </Button>
                )
              }
            />
          }
        />
      )}

      <PrincipalFormDialog
        open={formOpen || createParam.requested === 'principal'}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) createParam.clear();
        }}
      />
    </div>
  );
}
