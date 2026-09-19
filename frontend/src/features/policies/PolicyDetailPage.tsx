import { useEffect, useMemo, useState, type JSX } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Activity, History, Save, Trash2, Users } from 'lucide-react';
import type { PolicyStatement } from '@iamscope/types';
import { usePolicy } from '@/api/queries/policies';
import { usePrincipals } from '@/api/queries/principals';
import { useDeletePolicy, useUpdatePolicy } from '@/api/mutations/policies';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { PolicyEditor } from '@/components/domain/PolicyEditor';
import { PresenceBadge } from '@/components/domain/PresenceBadge';
import { countByEffect } from '@/lib/iam';
import { formatDate, formatRelative, truncateArn } from '@/lib/format';
import { policyRoutes, principalRoutes, ROUTES } from '@/lib/constants';
import { usePresence } from '@/hooks/usePresence';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useActiveOrgId, useSessionStore } from '@/stores/session';
import { ChangeReasonDialog } from './components/ChangeReasonDialog';

export default function PolicyDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const policyId = id ?? null;
  const orgId = useActiveOrgId();
  const navigate = useNavigate();

  const canWrite = useSessionStore((state) => state.permissions.canWrite);
  const canAdmin = useSessionStore((state) => state.permissions.canAdmin);

  const policy = usePolicy(orgId, policyId);
  const principals = usePrincipals(orgId, { pageSize: 200 });
  const updatePolicy = useUpdatePolicy();
  const deletePolicy = useDeletePolicy();

  const presence = usePresence({ entityType: 'policy', entityId: policyId });

  const [draft, setDraft] = useState<PolicyStatement[]>([]);
  const [dirty, setDirty] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);

  // Reset the draft whenever the server copy changes identity.
  useEffect(() => {
    if (policy.data) {
      setDraft(policy.data.statements);
      setDirty(false);
    }
  }, [policy.data]);

  const counts = useMemo(() => countByEffect(draft), [draft]);

  const attachedPrincipals = useMemo(
    () =>
      (principals.data?.items ?? []).filter((principal) =>
        policyId === null ? false : principal.attachedPolicies.includes(policyId),
      ),
    [policyId, principals.data],
  );

  const save = (): void => {
    if (policyId === null) return;
    updatePolicy.mutate(
      { id: policyId, statements: draft, changeReason: 'Edited from the policy detail view' },
      { onSuccess: () => setDirty(false) },
    );
  };

  // Cmd/Ctrl+S and Cmd/Ctrl+Enter both save, even while the editor has focus.
  useKeyboard(
    [
      {
        id: 'policy-save',
        keys: 'mod+s',
        description: 'Save policy',
        group: 'Actions',
        allowInInput: true,
        when: () => canWrite && policyId !== null,
        handler: () => save(),
      },
      {
        id: 'policy-save-enter',
        keys: 'mod+enter',
        description: 'Save policy',
        group: 'Actions',
        allowInInput: true,
        when: () => canWrite && policyId !== null,
        handler: () => save(),
      },
    ],
    { enabled: canWrite },
  );

  if (policyId === null) {
    return (
      <div className="panel">
        <EmptyState
          icon={History}
          title="No policy selected"
          description="Open a policy from the list."
        />
      </div>
    );
  }

  if (policy.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full rounded-panel" />
      </div>
    );
  }

  if (policy.isError || !policy.data) {
    return (
      <div className="panel">
        <ErrorState
          error={policy.error ?? new Error('Policy not found')}
          onRetry={() => void policy.refetch()}
        />
      </div>
    );
  }

  const data = policy.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {data.name}
            <Badge variant="muted" hideIcon>
              v{data.currentVersion}
            </Badge>
            {data.deleted ? <Badge variant="danger">Deleted</Badge> : null}
            {dirty ? <Badge variant="warn">Unsaved changes</Badge> : null}
          </span>
        }
        description={
          <span className="mono text-12 break-all text-text-muted" title={data.arn}>
            {data.arn}
          </span>
        }
        breadcrumbs={[{ label: 'Policies', to: ROUTES.policies }, { label: data.name }]}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={Activity}
              onClick={() => navigate(ROUTES.evaluate)}
            >
              Evaluate
            </Button>
            <Button variant="secondary" size="sm" iconLeft={History} asChild>
              <Link to={policyRoutes.versions(data.id)}>Versions</Link>
            </Button>
            <Button
              variant="primary"
              size="sm"
              iconLeft={Save}
              loading={updatePolicy.isPending}
              disabled={!canWrite || !dirty}
              onClick={() => setReasonOpen(true)}
            >
              Save new version
            </Button>
            <IconButton
              label={`Delete ${data.name}`}
              icon={Trash2}
              size="sm"
              disabled={!canAdmin || data.deleted}
              onClick={() => deletePolicy.mutate(data.id)}
            />
          </>
        }
      />

      <section className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <PresenceBadge
              peers={presence.editorsFor(data.id).map((entry) => ({
                id: entry.userId,
                name: entry.user.name,
                avatarUrl: entry.user.avatarUrl,
              }))}
            />
          </div>

          <PolicyEditor
            statements={draft}
            onChange={(next) => {
              setDraft(next);
              setDirty(true);
            }}
            readOnly={!canWrite}
            error={updatePolicy.error?.message ?? null}
          />
        </div>

        <aside className="flex flex-col gap-3">
          <div className="panel flex flex-col gap-2 p-3">
            <h2 className="text-12 font-semibold tracking-wide text-text-subtle uppercase">
              Summary
            </h2>
            <dl className="text-13 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-text-subtle">Statements</dt>
              <dd className="tabular text-text">{draft.length}</dd>
              <dt className="text-text-subtle">Allow</dt>
              <dd className="tabular text-allow">{counts.Allow}</dd>
              <dt className="text-text-subtle">Deny</dt>
              <dd className="tabular text-deny">{counts.Deny}</dd>
              <dt className="text-text-subtle">Updated</dt>
              <dd className="text-text-muted">{formatRelative(data.updatedAt)}</dd>
              <dt className="text-text-subtle">Created</dt>
              <dd className="text-text-muted">{formatDate(data.createdAt)}</dd>
            </dl>
          </div>

          <div className="panel flex flex-col gap-2 p-3">
            <h2 className="text-12 flex items-center gap-1.5 font-semibold tracking-wide text-text-subtle uppercase">
              <Users aria-hidden="true" className="size-3.5" />
              Attached to
            </h2>
            {principals.isLoading ? (
              <Skeleton className="h-4 w-full" />
            ) : attachedPrincipals.length === 0 ? (
              <p className="text-meta text-text-muted">
                No principal carries this policy yet. Attach it from a principal's page.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {attachedPrincipals.map((principal) => (
                  <li key={principal.id}>
                    <Link
                      to={principalRoutes.detail(principal.id)}
                      className="text-13 dur-fast flex items-center justify-between gap-2 rounded-input px-1 py-0.5 no-underline outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <span className="truncate text-text">{principal.name}</span>
                      <Badge variant="muted" hideIcon>
                        {principal.type}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel flex flex-col gap-2 p-3">
            <h2 className="text-12 font-semibold tracking-wide text-text-subtle uppercase">Tags</h2>
            {Object.keys(data.tags).length === 0 ? (
              <p className="text-meta text-text-muted">No tags.</p>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {Object.entries(data.tags).map(([key, value]) => (
                  <li key={key}>
                    <Badge variant="outline" hideIcon>
                      {key}={value}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-micro text-text-subtle">
            ARN <span className="mono break-all">{truncateArn(data.arn, { max: 120 })}</span>
          </p>
        </aside>
      </section>

      <ChangeReasonDialog
        open={reasonOpen}
        onOpenChange={setReasonOpen}
        summary={`${draft.length} statements · v${data.currentVersion} → v${data.currentVersion + 1}`}
        pending={updatePolicy.isPending}
        onConfirm={(reason) => {
          updatePolicy.mutate(
            { id: data.id, statements: draft, changeReason: reason, tags: data.tags },
            {
              onSuccess: () => {
                setDirty(false);
                setReasonOpen(false);
              },
            },
          );
        }}
      />
    </div>
  );
}
