import { useMemo, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MailPlus, UserMinus, Users } from 'lucide-react';
import type { Membership, Role } from '@iamscope/types';
import { useMembers } from '@/api/queries/orgs';
import { useRemoveMember, useUpdateMemberRole } from '@/api/mutations/orgs';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Table, type Column } from '@/components/ui/Table';
import { Toolbar, ToolbarSpacer } from '@/components/ui/Toolbar';
import { ROLE_LABELS, ROLE_ORDER, orgRoutes } from '@/lib/constants';
import { formatRelative } from '@/lib/format';
import { useActiveOrg, useCurrentUser, useRole } from '@/stores/session';
import { NoOrgNotice } from './components/NoOrgNotice';

/** Only a role at or below the actor's own rank may be assigned. */
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

function assignableRolesFor(actor: Role | null): Role[] {
  const ceiling = actor === null ? -1 : RANK[actor];
  return ROLE_ORDER.filter((role) => role !== 'owner' && RANK[role] <= ceiling);
}

export default function MembersPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const activeOrg = useActiveOrg();
  const currentUser = useCurrentUser();
  const actorRole = useRole();
  const orgId = params.id ?? activeOrg?.id ?? null;

  const members = useMembers(orgId, { pageSize: 200 });
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();

  const roleOptions = useMemo(
    () => assignableRolesFor(actorRole).map((role) => ({ value: role, label: ROLE_LABELS[role] })),
    [actorRole],
  );

  const columns = useMemo<Column<Membership>[]>(
    () => [
      {
        id: 'member',
        header: 'Member',
        minWidth: 240,
        accessor: (member) => {
          const name = member.user?.name ?? 'Unknown user';
          return (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={name} src={member.user?.avatarUrl ?? null} size="md" decorative />
              <span className="flex min-w-0 flex-col">
                <span className="text-13 truncate text-text">{name}</span>
                <span className="text-micro truncate text-text-subtle">
                  {member.user?.email ?? member.userId}
                </span>
              </span>
            </span>
          );
        },
      },
      {
        id: 'role',
        header: 'Role',
        width: 180,
        accessor: (member) => {
          const isSelf = member.userId === currentUser?.id;
          // The owner row and your own row are not editable - that avoids lockout.
          const locked = member.role === 'owner' || isSelf;
          const options = roleOptions.some((option) => option.value === member.role)
            ? roleOptions
            : [{ value: member.role, label: ROLE_LABELS[member.role] }, ...roleOptions];
          return (
            <Select
              size="sm"
              ariaLabel={`Role for ${member.user?.name ?? member.userId}`}
              value={member.role}
              options={locked && member.role !== 'owner' ? [] : options}
              disabled={locked || roleOptions.length === 0}
              onValueChange={(next) =>
                updateRole.mutate({ userId: member.userId, role: next as Role })
              }
            />
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        width: 120,
        accessor: (member) =>
          member.status === 'active' ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="warn">{member.status}</Badge>
          ),
      },
      {
        id: 'joinedAt',
        header: 'Joined',
        width: 140,
        accessor: (member) => (
          <span className="text-micro text-text-muted">{formatRelative(member.joinedAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        width: 56,
        align: 'right',
        accessor: (member) => (
          <IconButton
            label={`Remove ${member.user?.name ?? member.userId}`}
            icon={UserMinus}
            size="sm"
            disabled={member.role === 'owner' || member.userId === currentUser?.id}
            onClick={() => removeMember.mutate(member.userId)}
          />
        ),
      },
    ],
    [currentUser?.id, removeMember, roleOptions, updateRole],
  );

  if (orgId === null) return <NoOrgNotice />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Members"
        description="Who can read, write, evaluate and administer this organization. Role changes apply immediately and are audited."
        breadcrumbs={[{ label: activeOrg?.name ?? 'Organization' }, { label: 'Members' }]}
        actions={
          <Button variant="primary" size="sm" iconLeft={MailPlus} asChild>
            <Link to={orgRoutes.invitations(orgId)}>Invite someone</Link>
          </Button>
        }
      />

      <Toolbar label="Member summary">
        <span className="text-12 flex items-center gap-1.5 text-text-muted">
          <Users aria-hidden="true" className="size-3.5" />
          {members.isLoading ? 'Loading…' : `${members.data?.total ?? 0} members`}
        </span>
        <ToolbarSpacer>
          <span className="text-micro text-text-subtle">
            Owner cannot be changed here, and you cannot change your own role.
          </span>
        </ToolbarSpacer>
      </Toolbar>

      {members.isError ? (
        <div className="panel">
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        </div>
      ) : (
        <Table
          columns={columns}
          rows={members.data?.items ?? []}
          getRowId={(member) => member.id}
          loading={members.isLoading}
          emptyState={
            <EmptyState
              icon={Users}
              title="No members yet"
              description="Invite a colleague so they can review the same policies you are."
            />
          }
        />
      )}
    </div>
  );
}
