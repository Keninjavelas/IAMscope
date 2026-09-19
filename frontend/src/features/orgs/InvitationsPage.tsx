import { useMemo, useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import { Copy, Link2, MailPlus, Trash2 } from 'lucide-react';
import type { Invitation, Role } from '@iamscope/types';
import { useInvitations } from '@/api/queries/orgs';
import { useCreateInvitation, useRevokeInvitation } from '@/api/mutations/orgs';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, type Column } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/constants';
import { formatDate, formatRelative } from '@/lib/format';
import { useActiveOrg } from '@/stores/session';
import { NoOrgNotice } from './components/NoOrgNotice';

const ROLE_OPTIONS: { value: string; label: string }[] = (
  ['viewer', 'member', 'admin'] as const
).map((role) => ({ value: role, label: ROLE_LABELS[role] }));

function inviteLink(token: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/signup?invite=${encodeURIComponent(token)}`;
}

export default function InvitationsPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const activeOrg = useActiveOrg();
  const orgId = params.id ?? activeOrg?.id ?? null;

  const invitations = useInvitations(orgId);
  const createInvitation = useCreateInvitation();
  const revokeInvitation = useRevokeInvitation();
  const { toast, error: toastError } = useToast();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('member');
  const [issued, setIssued] = useState<Invitation | null>(null);

  const emailLooksValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const columns = useMemo<Column<Invitation>[]>(
    () => [
      {
        id: 'email',
        header: 'Invitee',
        minWidth: 220,
        accessor: (invitation) => (
          <span className="text-13 truncate text-text">{invitation.email}</span>
        ),
      },
      {
        id: 'role',
        header: 'Role',
        width: 120,
        accessor: (invitation) => (
          <Badge variant="muted" hideIcon>
            {ROLE_LABELS[invitation.role]}
          </Badge>
        ),
      },
      {
        id: 'invitedBy',
        header: 'Invited by',
        width: 160,
        accessor: (invitation) => (
          <span className="text-micro text-text-muted">{invitation.invitedByName ?? '—'}</span>
        ),
      },
      {
        id: 'expiresAt',
        header: 'Expires',
        width: 150,
        accessor: (invitation) => (
          <span className="text-micro text-text-muted" title={formatDate(invitation.expiresAt)}>
            {formatRelative(invitation.expiresAt, false)}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        width: 120,
        accessor: (invitation) =>
          invitation.acceptedAt !== null ? (
            <Badge variant="success">Accepted</Badge>
          ) : new Date(invitation.expiresAt) < new Date() ? (
            <Badge variant="muted">Expired</Badge>
          ) : (
            <Badge variant="info">Pending</Badge>
          ),
      },
      {
        id: 'actions',
        header: '',
        width: 100,
        align: 'right',
        accessor: (invitation) => (
          <span className="flex items-center justify-end gap-0.5">
            {invitation.token ? (
              <IconButton
                label={`Copy invite link for ${invitation.email}`}
                icon={Link2}
                size="sm"
                onClick={() => {
                  const link = inviteLink(invitation.token ?? '');
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => toast({ title: 'Invite link copied', description: link }))
                    .catch(() => toastError('Could not copy link'));
                }}
              />
            ) : null}
            <IconButton
              label={`Revoke invitation for ${invitation.email}`}
              icon={Trash2}
              size="sm"
              disabled={invitation.acceptedAt !== null}
              onClick={() => revokeInvitation.mutate(invitation.id)}
            />
          </span>
        ),
      },
    ],
    [revokeInvitation, toast, toastError],
  );

  const submit = (): void => {
    if (!emailLooksValid) return;
    createInvitation.mutate(
      { email: email.trim(), role },
      {
        onSuccess: (invitation) => {
          setIssued(invitation);
          setOpen(false);
          setEmail('');
        },
      },
    );
  };

  if (orgId === null) return <NoOrgNotice />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Invitations"
        description="Pending invites for this organization. Links expire, and revoking one kills the old link immediately."
        breadcrumbs={[{ label: activeOrg?.name ?? 'Organization' }, { label: 'Invitations' }]}
        actions={
          <Button variant="primary" size="sm" iconLeft={MailPlus} onClick={() => setOpen(true)}>
            Invite by email
          </Button>
        }
      />

      {invitations.isError ? (
        <div className="panel">
          <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
        </div>
      ) : invitations.isLoading ? (
        <Skeleton className="h-40 w-full rounded-panel" />
      ) : (
        <Table
          columns={columns}
          rows={invitations.data ?? []}
          getRowId={(invitation) => invitation.id}
          stickyHeader={false}
          emptyState={
            <EmptyState
              icon={MailPlus}
              title="No invitations yet"
              description="Invite a teammate by email. They will be able to sign up straight into this organization with the role you choose."
            />
          }
        />
      )}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title="Invite someone"
        description="They receive a single-use link. Email delivery is v2, so the link is shown here too."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              iconLeft={MailPlus}
              loading={createInvitation.isPending}
              disabled={!emailLooksValid}
              onClick={submit}
            >
              Send invitation
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Email"
            type="email"
            autoFocus
            required
            value={email}
            error={
              email !== '' && !emailLooksValid ? 'That does not look like an email address.' : null
            }
            onChange={(event) => setEmail(event.target.value)}
          />
          <Select
            label="Role"
            value={role}
            options={ROLE_OPTIONS}
            onValueChange={(value) => setRole(value as Exclude<Role, 'owner'>)}
          />
          <p className="text-micro text-text-subtle">{ROLE_DESCRIPTIONS[role]}</p>
        </div>
      </Dialog>

      <Dialog
        open={issued !== null}
        onOpenChange={(next) => {
          if (!next) setIssued(null);
        }}
        size="sm"
        title="Invitation created"
        description="Copy the link now - it is only shown for the invitation you just created."
        footer={
          <Button variant="secondary" size="sm" onClick={() => setIssued(null)}>
            Done
          </Button>
        }
      >
        {issued?.token ? (
          <div className="flex flex-col gap-2">
            <code className="mono text-micro break-all rounded-input border border-border bg-bg-inset px-2 py-1.5 text-text">
              {inviteLink(issued.token)}
            </code>
            <Button
              size="sm"
              variant="secondary"
              iconLeft={Copy}
              className="w-fit"
              onClick={() => {
                void navigator.clipboard.writeText(inviteLink(issued.token ?? ''));
                toast({ title: 'Invite link copied' });
              }}
            >
              Copy link
            </Button>
          </div>
        ) : (
          <p className="text-13 text-text-muted">
            The invitation was created for {issued?.email ?? 'the invitee'}.
          </p>
        )}
      </Dialog>
    </div>
  );
}
