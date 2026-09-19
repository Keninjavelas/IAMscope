import { useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import type { ScenarioWithResult } from '@iamscope/types';
import { useScenarios } from '@/api/queries/scenarios';
import { useDeleteScenario } from '@/api/mutations/scenarios';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Table, type Column } from '@/components/ui/Table';
import { Toolbar, ToolbarSpacer } from '@/components/ui/Toolbar';
import { ResultBadge } from '@/components/domain/ResultBadge';
import { arnName, formatCount, formatRelative } from '@/lib/format';
import { useActiveOrgId, useSessionStore } from '@/stores/session';
import { useCreateParam } from '@/hooks/useCreateParam';
import { ScenarioFormDialog } from './components/ScenarioFormDialog';
import { NoOrgNotice } from '@/features/orgs/components/NoOrgNotice';

export default function ScenariosPage(): JSX.Element {
  const orgId = useActiveOrgId();
  const canWrite = useSessionStore((state) => state.permissions.canWrite);
  const canAdmin = useSessionStore((state) => state.permissions.canAdmin);

  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';

  const scenarios = useScenarios(orgId, { ...(q === '' ? {} : { q }), pageSize: 200 });
  const deleteScenario = useDeleteScenario();
  const createParam = useCreateParam(['scenario'] as const);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScenarioWithResult | null>(null);

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

  const columns = useMemo<Column<ScenarioWithResult>[]>(
    () => [
      {
        id: 'name',
        header: 'Scenario',
        minWidth: 240,
        accessor: (scenario) => (
          <span className="flex min-w-0 flex-col">
            <span className="text-13 truncate text-text">{scenario.name}</span>
            <span className="text-micro truncate text-text-subtle">
              {arnName(scenario.principalArn)}
            </span>
          </span>
        ),
      },
      {
        id: 'action',
        header: 'Action',
        width: 170,
        mono: true,
        accessor: (scenario) => scenario.action,
      },
      {
        id: 'resource',
        header: 'Resource',
        minWidth: 200,
        truncate: true,
        accessor: (scenario) => (
          <span className="mono text-12 text-text-muted" title={scenario.resourceArn}>
            {arnName(scenario.resourceArn)}
          </span>
        ),
      },
      {
        id: 'expected',
        header: 'Expected',
        width: 120,
        accessor: (scenario) => (
          <ResultBadge result={scenario.expectedResult} label={scenario.expectedResult} />
        ),
      },
      {
        id: 'actual',
        header: 'Last result',
        width: 150,
        accessor: (scenario) =>
          scenario.lastResult === null ? (
            <Badge variant="muted">Not evaluated</Badge>
          ) : (
            <span className="flex items-center gap-1">
              <ResultBadge result={scenario.lastResult} />
              {scenario.lastResult === scenario.expectedResult ? (
                <Badge variant="success">match</Badge>
              ) : (
                <Badge variant="danger">drift</Badge>
              )}
            </span>
          ),
      },
      {
        id: 'tags',
        header: 'Tags',
        width: 160,
        accessor: (scenario) =>
          scenario.tags.length === 0 ? (
            <span className="text-micro text-text-subtle">—</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {scenario.tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="outline" hideIcon>
                  {tag}
                </Badge>
              ))}
            </span>
          ),
      },
      {
        id: 'lastRunAt',
        header: 'Last run',
        width: 130,
        accessor: (scenario) => (
          <span className="text-micro text-text-muted">
            {scenario.lastRunAt === null ? 'Never' : formatRelative(scenario.lastRunAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        width: 110,
        align: 'right',
        accessor: (scenario) => (
          <span className="flex items-center justify-end gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={!canWrite}
              onClick={() => setEditing(scenario)}
            >
              Edit
            </Button>
            <IconButton
              label={`Delete ${scenario.name}`}
              icon={Trash2}
              size="sm"
              disabled={!canAdmin}
              onClick={() => deleteScenario.mutate(scenario.id)}
            />
          </span>
        ),
      },
    ],
    [canAdmin, canWrite, deleteScenario],
  );

  if (orgId === null) return <NoOrgNotice />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Scenarios"
        description="Saved access questions with the answer you expect. A drift badge means the engine disagrees with you."
        breadcrumbs={[{ label: 'Workbench' }, { label: 'Scenarios' }]}
        actions={
          <Button
            variant="primary"
            size="sm"
            iconLeft={Plus}
            disabled={!canWrite}
            onClick={() => setFormOpen(true)}
          >
            New scenario
          </Button>
        }
      />

      <Toolbar label="Scenario filters">
        <Input
          data-search-input
          inputSize="sm"
          value={q}
          aria-label="Search scenarios"
          placeholder="Search name, action or tag…"
          wrapperClassName="w-[280px]"
          onChange={(event) => updateParam('q', event.target.value)}
        />
        <ToolbarSpacer>
          <span className="text-micro text-text-subtle" aria-live="polite">
            {scenarios.isLoading ? 'Loading…' : `${formatCount(scenarios.data?.total ?? 0)} total`}
          </span>
        </ToolbarSpacer>
      </Toolbar>

      {scenarios.isError ? (
        <div className="panel">
          <ErrorState error={scenarios.error} onRetry={() => void scenarios.refetch()} />
        </div>
      ) : (
        <Table
          className="max-h-[calc(100vh-260px)]"
          columns={columns}
          rows={scenarios.data?.items ?? []}
          getRowId={(scenario) => scenario.id}
          loading={scenarios.isLoading}
          emptyState={
            <EmptyState
              icon={FlaskConical}
              title={q === '' ? 'No scenarios yet' : 'No scenario matches that search'}
              description={
                q === ''
                  ? 'Write down the access questions you care about - “can the analyst read the reports bucket?” - and give each an expected answer. The Evaluate lens checks them all at once.'
                  : 'Try a shorter search term or clear it.'
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
                    New scenario
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

      <ScenarioFormDialog
        open={formOpen || createParam.requested === 'scenario'}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) createParam.clear();
        }}
      />

      <ScenarioFormDialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        scenario={editing}
      />
    </div>
  );
}
