import { useMemo, useState, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Link2, Pencil, ShieldAlert, Trash2, Unlink, Users } from 'lucide-react';
import type { Policy } from '@iamscope/types';
import { usePrincipal } from '@/api/queries/principals';
import { usePolicies } from '@/api/queries/policies';
import { useAttachPolicy, useDeletePrincipal, useDetachPolicy } from '@/api/mutations/principals';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { PresenceBadge } from '@/components/domain/PresenceBadge';
import { severityPresentation } from '@/lib/graph';
import { formatDate, formatRelative, truncateArn } from '@/lib/format';
import { policyRoutes, ROUTES } from '@/lib/constants';
import { usePresence } from '@/hooks/usePresence';
import { useActiveOrgId, useSessionStore } from '@/stores/session';
import { PrincipalFormDialog } from './components/PrincipalFormDialog';
import { NoOrgNotice } from '@/features/orgs/components/NoOrgNotice';

export default function PrincipalDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const principalId = id ?? null;
  const orgId = useActiveOrgId();

  const canWrite = useSessionStore((state) => state.permissions.canWrite);
  const canAdmin = useSessionStore((state) => state.permissions.canAdmin);

  const principal = usePrincipal(orgId, principalId);
  const policies = usePolicies(orgId, { pageSize: 200 });
  const attach = useAttachPolicy();
  const detach = useDetachPolicy();
  const remove = useDeletePrincipal();
  const presence = usePresence({ entityType: 'principal', entityId: principalId });

  const [editing, setEditing] = useState(false);
  const [pendingPolicy, setPendingPolicy] = useState<string | null>(null);

  const attachedIds = useMemo(
    () => new Set(principal.data?.attachedPolicies ?? []),
    [principal.data],
  );

  const attachableItems = useMemo(
    () =>
      (policies.data?.items ?? [])
        .filter((policy: Policy) => !attachedIds.has(policy.id) && !policy.deleted)
        .map((policy) => ({
          value: policy.id,
          label: policy.name,
          description: truncateArn(policy.arn, { max: 56 }),
          group: Object.entries(policy.tags)[0]?.[1] ?? 'Policies',
          keywords: [policy.arn, ...Object.values(policy.tags)],
        })),
    [attachedIds, policies.data],
  );

  if (orgId === null) return <NoOrgNotice />;
  if (principalId === null) {
    return (
      <div className="panel">
        <EmptyState
          icon={Users}
          title="No principal selected"
          description="Open one from the list."
        />
      </div>
    );
  }

  if (principal.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-56 w-full rounded-panel" />
      </div>
    );
  }

  if (principal.isError || !principal.data) {
    return (
      <div className="panel">
        <ErrorState
          error={principal.error ?? new Error('Principal not found')}
          onRetry={() => void principal.refetch()}
        />
      </div>
    );
  }

  const data = principal.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {data.name}
            <Badge variant={data.type === 'Role' ? 'accent' : 'info'} hideIcon>
              {data.type}
            </Badge>
            {data.deleted ? <Badge variant="danger">Deleted</Badge> : null}
          </span>
        }
        description={<span className="mono text-12 break-all text-text-muted">{data.arn}</span>}
        breadcrumbs={[{ label: 'Principals', to: ROUTES.principals }, { label: data.name }]}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={Pencil}
              disabled={!canWrite}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to={`${ROUTES.graph}?from=${encodeURIComponent(data.arn)}`}>
                Find escalation
              </Link>
            </Button>
            <IconButton
              label={`Delete ${data.name}`}
              icon={Trash2}
              size="sm"
              disabled={!canAdmin || data.deleted}
              onClick={() => remove.mutate(data.id)}
            />
          </>
        }
      />

      <PresenceBadge
        peers={presence.editorsFor(data.id).map((entry) => ({
          id: entry.userId,
          name: entry.user.name,
          avatarUrl: entry.user.avatarUrl,
        }))}
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel flex flex-col gap-3 p-3">
          <h2 className="text-12 flex items-center gap-1.5 font-semibold tracking-wide text-text-subtle uppercase">
            <Link2 aria-hidden="true" className="size-3.5" />
            Attached policies
          </h2>

          {data.attachedPolicySummaries.length === 0 ? (
            <p className="text-meta text-text-muted">
              No policy is attached. Without one this principal can do nothing - attach a policy to
              give it permissions.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {data.attachedPolicySummaries.map((policy) => (
                <li
                  key={policy.id}
                  className="flex items-center justify-between gap-2 rounded-input border border-border bg-bg-inset px-2 py-1"
                >
                  <span className="flex min-w-0 flex-col">
                    <Link
                      to={policyRoutes.detail(policy.id)}
                      className="text-13 dur-fast truncate text-text no-underline hover:text-accent"
                    >
                      {policy.name}
                    </Link>
                    <span className="mono text-micro truncate text-text-subtle">
                      v{policy.currentVersion}
                    </span>
                  </span>
                  <IconButton
                    label={`Detach ${policy.name}`}
                    icon={Unlink}
                    size="sm"
                    disabled={!canWrite}
                    onClick={() => detach.mutate({ principalId: data.id, policyId: policy.id })}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-2 border-t border-border pt-3">
            <Combobox
              className="flex-1"
              label="Attach a policy"
              value={pendingPolicy}
              onChange={setPendingPolicy}
              items={attachableItems}
              disabled={!canWrite}
              allowClear
              placeholder="Choose a policy…"
              emptyMessage={
                policies.isLoading
                  ? 'Loading policies…'
                  : attachableItems.length === 0
                    ? 'Every policy is already attached.'
                    : 'No policy matches that search.'
              }
            />
            <Button
              variant="primary"
              size="sm"
              iconLeft={Link2}
              loading={attach.isPending}
              disabled={!canWrite || pendingPolicy === null}
              onClick={() => {
                if (pendingPolicy === null) return;
                attach.mutate(
                  { principalId: data.id, policyId: pendingPolicy },
                  { onSuccess: () => setPendingPolicy(null) },
                );
              }}
            >
              Attach
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel flex flex-col gap-2 p-3">
            <h2 className="text-12 font-semibold tracking-wide text-text-subtle uppercase">
              Escalation reachability
            </h2>
            {data.escalationOut.length === 0 && data.escalationIn.length === 0 ? (
              <p className="text-meta text-text-muted">
                No escalation edges touch this principal. Add assume-role targets or attach a policy
                that grants
                <span className="mono"> iam:PassRole</span> to change that.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.escalationOut.length > 0 ? (
                  <div>
                    <p className="text-micro mb-1 text-text-subtle">Can escalate into</p>
                    <ul className="flex flex-col gap-1">
                      {data.escalationOut.map((link) => {
                        const severity = severityPresentation(link.severity);
                        return (
                          <li
                            key={link.principalArn}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="text-13 truncate text-text">{link.principalName}</span>
                            <Badge
                              variant={
                                link.severity === 'high'
                                  ? 'danger'
                                  : link.severity === 'medium'
                                    ? 'warn'
                                    : 'info'
                              }
                            >
                              {severity.label}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {data.escalationIn.length > 0 ? (
                  <div>
                    <p className="text-micro mb-1 text-text-subtle">Escalatable from</p>
                    <ul className="flex flex-col gap-1">
                      {data.escalationIn.map((link) => (
                        <li
                          key={link.principalArn}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="text-13 truncate text-text">{link.principalName}</span>
                          <Badge variant="muted" hideIcon>
                            {severityPresentation(link.severity).label}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="panel flex flex-col gap-2 p-3">
            <h2 className="text-12 flex items-center gap-1.5 font-semibold tracking-wide text-text-subtle uppercase">
              <ShieldAlert aria-hidden="true" className="size-3.5" />
              Structure
            </h2>
            <dl className="text-13 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-text-subtle">Group memberships</dt>
              <dd className="text-text">
                {data.groupMemberships.length === 0 ? '—' : data.groupMemberships.join(', ')}
              </dd>
              <dt className="text-text-subtle">Assume targets</dt>
              <dd className="mono break-all text-text">
                {data.assumeRoleTargets.length === 0 ? '—' : data.assumeRoleTargets.join(', ')}
              </dd>
              <dt className="text-text-subtle">Boundary policy</dt>
              <dd className="text-text">
                {data.boundaryPolicyId === null ? (
                  'None'
                ) : (
                  <Link to={policyRoutes.detail(data.boundaryPolicyId)}>View boundary</Link>
                )}
              </dd>
              <dt className="text-text-subtle">Members</dt>
              <dd className="text-text-muted">
                {data.memberNames.length === 0 ? '—' : data.memberNames.join(', ')}
              </dd>
              <dt className="text-text-subtle">Updated</dt>
              <dd className="text-text-muted">{formatRelative(data.updatedAt)}</dd>
              <dt className="text-text-subtle">Created</dt>
              <dd className="text-text-muted">{formatDate(data.createdAt)}</dd>
            </dl>
          </div>
        </div>
      </section>

      <PrincipalFormDialog open={editing} onOpenChange={setEditing} principal={data} />
    </div>
  );
}
