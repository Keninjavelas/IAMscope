import { useMemo, useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import { History, RotateCcw } from 'lucide-react';
import type { PolicyVersion } from '@iamscope/types';
import { usePolicy, usePolicyVersions } from '@/api/queries/policies';
import { useRestorePolicy } from '@/api/mutations/policies';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { JsonDiff } from '@/components/ui/JsonDiff';
import { PageHeader } from '@/components/ui/PageHeader';
import { Table, type Column } from '@/components/ui/Table';
import { ROUTES } from '@/lib/constants';
import { formatDate, formatRelative } from '@/lib/format';
import { statementsToDocument } from '@/lib/iam';
import { useActiveOrgId, useSessionStore } from '@/stores/session';
import { ChangeReasonDialog } from './components/ChangeReasonDialog';

interface Selection {
  before: number | null;
  after: number | null;
}

export default function PolicyVersionsPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const policyId = id ?? null;
  const orgId = useActiveOrgId();
  const canAdmin = useSessionStore((state) => state.permissions.canAdmin);

  const policy = usePolicy(orgId, policyId);
  const versions = usePolicyVersions(orgId, policyId);
  const restore = useRestorePolicy();

  const [selection, setSelection] = useState<Selection>({ before: null, after: null });
  const [restoreTarget, setRestoreTarget] = useState<PolicyVersion | null>(null);

  const ordered = useMemo(
    () => [...(versions.data ?? [])].sort((a, b) => b.version - a.version),
    [versions.data],
  );

  // Default to comparing the two most recent versions - the common question.
  const effective: Selection = useMemo(() => {
    if (selection.before !== null && selection.after !== null) return selection;
    const newest = ordered[0];
    const second = ordered[1];
    return {
      after: selection.after ?? newest?.version ?? null,
      before: selection.before ?? second?.version ?? null,
    };
  }, [ordered, selection]);

  const beforeVersion = ordered.find((entry) => entry.version === effective.before) ?? null;
  const afterVersion = ordered.find((entry) => entry.version === effective.after) ?? null;

  const columns = useMemo<Column<PolicyVersion>[]>(
    () => [
      {
        id: 'version',
        header: 'Version',
        width: 100,
        mono: true,
        accessor: (version) => (
          <span className="flex items-center gap-1">
            <span className="tabular text-text">v{version.version}</span>
            {version.version === policy.data?.currentVersion ? (
              <Badge variant="accent" hideIcon>
                current
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        id: 'changeReason',
        header: 'Reason',
        minWidth: 240,
        truncate: true,
        accessor: (version) => (
          <span title={version.changeReason} className="text-13 text-text-muted">
            {version.changeReason}
          </span>
        ),
      },
      {
        id: 'statements',
        header: 'Statements',
        width: 110,
        align: 'right',
        mono: true,
        accessor: (version) => version.statements.length,
      },
      {
        id: 'createdAt',
        header: 'When',
        width: 190,
        accessor: (version) => (
          <span
            className="text-micro text-text-muted"
            title={formatDate(version.createdAt, 'yyyy-MM-dd HH:mm:ss')}
          >
            {formatRelative(version.createdAt)}
          </span>
        ),
      },
      {
        id: 'compare',
        header: 'Compare',
        width: 170,
        accessor: (version) => (
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelection((previous) => ({ ...previous, before: version.version }))}
            >
              as before
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelection((previous) => ({ ...previous, after: version.version }))}
            >
              as after
            </Button>
          </span>
        ),
      },
      {
        id: 'restore',
        header: '',
        width: 110,
        accessor: (version) => (
          <Button
            size="sm"
            variant="secondary"
            iconLeft={RotateCcw}
            disabled={!canAdmin || version.version === policy.data?.currentVersion}
            onClick={() => setRestoreTarget(version)}
          >
            Restore
          </Button>
        ),
      },
    ],
    [canAdmin, policy.data?.currentVersion],
  );

  if (policyId === null) {
    return (
      <div className="panel">
        <EmptyState icon={History} title="No policy selected" description="Open a policy first." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Version history
            {policy.data ? (
              <Badge variant="muted" hideIcon>
                {policy.data.name}
              </Badge>
            ) : null}
          </span>
        }
        description="Every save is an immutable version. Diff any two to see exactly what changed, then restore if needed."
        breadcrumbs={[
          { label: 'Policies', to: ROUTES.policies },
          { label: policy.data?.name ?? 'Policy', to: `/policies/${policyId}` },
          { label: 'Versions' },
        ]}
      />

      {versions.isError ? (
        <div className="panel">
          <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
        </div>
      ) : (
        <Table
          className="max-h-[360px]"
          columns={columns}
          rows={ordered}
          getRowId={(version) => version.id}
          loading={versions.isLoading}
          emptyState={
            <EmptyState
              icon={History}
              title="No versions recorded yet"
              description="Versions appear here the first time the policy is saved."
            />
          }
        />
      )}

      {beforeVersion && afterVersion ? (
        <JsonDiff
          title={`v${beforeVersion.version} → v${afterVersion.version}`}
          before={statementsToDocument(beforeVersion.statements)}
          after={statementsToDocument(afterVersion.statements)}
          mode="word"
        />
      ) : null}

      <ChangeReasonDialog
        open={restoreTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRestoreTarget(null);
        }}
        summary={
          restoreTarget ? `Restore v${restoreTarget.version}: ${restoreTarget.changeReason}` : ''
        }
        confirmLabel="Restore version"
        pending={restore.isPending}
        onConfirm={(reason) => {
          if (!restoreTarget) return;
          restore.mutate(
            { id: policyId, version: restoreTarget.version, changeReason: reason },
            { onSuccess: () => setRestoreTarget(null) },
          );
        }}
      />
    </div>
  );
}
