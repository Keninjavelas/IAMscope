import { useMemo, useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import type { ApiKey, ApiKeyScope } from '@iamscope/types';
import { API_KEY_SCOPES } from '@iamscope/types';
import { useApiKeys } from '@/api/queries/orgs';
import { useCreateApiKey, useRevokeApiKey } from '@/api/mutations/orgs';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, type Column } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { API_KEY_SCOPE_DESCRIPTIONS, API_KEY_SCOPE_LABELS } from '@/lib/constants';
import { formatDate, formatRelative } from '@/lib/format';
import { useActiveOrg } from '@/stores/session';
import { NoOrgNotice } from './components/NoOrgNotice';

export default function ApiKeysPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const activeOrg = useActiveOrg();
  const orgId = params.id ?? activeOrg?.id ?? null;

  const keys = useApiKeys(orgId);
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['read']);
  const [expiresAt, setExpiresAt] = useState('');
  const [secret, setSecret] = useState<string | null>(null);

  const columns = useMemo<Column<ApiKey>[]>(
    () => [
      {
        id: 'name',
        header: 'Key',
        minWidth: 200,
        accessor: (key) => (
          <span className="flex min-w-0 flex-col">
            <span className="text-13 truncate text-text">{key.name}</span>
            <span className="mono text-micro text-text-subtle">{key.prefix}…</span>
          </span>
        ),
      },
      {
        id: 'scopes',
        header: 'Scopes',
        minWidth: 220,
        accessor: (key) => (
          <span className="flex flex-wrap items-center gap-1">
            {key.scopes.map((scope) => (
              <Badge key={scope} variant="outline" hideIcon>
                {API_KEY_SCOPE_LABELS[scope]}
              </Badge>
            ))}
          </span>
        ),
      },
      {
        id: 'lastUsedAt',
        header: 'Last used',
        width: 150,
        accessor: (key) => (
          <span className="text-micro text-text-muted">
            {key.lastUsedAt === null ? 'Never' : formatRelative(key.lastUsedAt)}
          </span>
        ),
      },
      {
        id: 'expiresAt',
        header: 'Expires',
        width: 150,
        accessor: (key) => (
          <span className="text-micro text-text-muted">
            {key.expiresAt === null ? 'Never' : formatDate(key.expiresAt, 'yyyy-MM-dd')}
          </span>
        ),
      },
      {
        id: 'revokedAt',
        header: 'Status',
        width: 110,
        accessor: (key) =>
          key.revokedAt !== null ? (
            <Badge variant="danger">Revoked</Badge>
          ) : (
            <Badge variant="success">Active</Badge>
          ),
      },
      {
        id: 'actions',
        header: '',
        width: 56,
        align: 'right',
        accessor: (key) => (
          <IconButton
            label={`Revoke ${key.name}`}
            icon={Trash2}
            size="sm"
            disabled={key.revokedAt !== null}
            onClick={() => revokeKey.mutate(key.id)}
          />
        ),
      },
    ],
    [revokeKey],
  );

  const toggleScope = (scope: ApiKeyScope): void => {
    setScopes((previous) =>
      previous.includes(scope) ? previous.filter((entry) => entry !== scope) : [...previous, scope],
    );
  };

  const submit = (): void => {
    if (name.trim() === '' || scopes.length === 0) return;
    createKey.mutate(
      {
        name: name.trim(),
        scopes,
        expiresAt: expiresAt === '' ? null : new Date(expiresAt).toISOString(),
      },
      {
        onSuccess: (created) => {
          setSecret(created.secret ?? null);
          setOpen(false);
          setName('');
          setScopes(['read']);
          setExpiresAt('');
        },
      },
    );
  };

  if (orgId === null) return <NoOrgNotice />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="API keys"
        description="Machine credentials for this organization. Scope them narrowly: a key can only ever do what its scopes and the owner's role allow."
        breadcrumbs={[{ label: activeOrg?.name ?? 'Organization' }, { label: 'API keys' }]}
        actions={
          <Button variant="primary" size="sm" iconLeft={Plus} onClick={() => setOpen(true)}>
            New API key
          </Button>
        }
      />

      {keys.isError ? (
        <div className="panel">
          <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
        </div>
      ) : keys.isLoading ? (
        <Skeleton className="h-40 w-full rounded-panel" />
      ) : (
        <Table
          columns={columns}
          rows={keys.data ?? []}
          getRowId={(key) => key.id}
          stickyHeader={false}
          emptyState={
            <EmptyState
              icon={KeyRound}
              title="No API keys yet"
              description="Create a key to let CI or a script read and evaluate this organization without a browser session."
            />
          }
        />
      )}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title="Create an API key"
        description="The secret is shown once, immediately after creation. Store it in a secret manager."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              iconLeft={Plus}
              loading={createKey.isPending}
              disabled={name.trim() === '' || scopes.length === 0}
              onClick={submit}
            >
              Create key
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Name"
            autoFocus
            required
            value={name}
            placeholder="ci-pipeline"
            onChange={(event) => setName(event.target.value)}
          />

          <fieldset className="flex flex-col gap-1">
            <legend className="text-12 mb-1 font-medium text-text-muted">Scopes</legend>
            {API_KEY_SCOPES.map((scope) => (
              <label key={scope} className="text-13 flex items-start gap-2 text-text">
                <RadixCheckbox.Root
                  checked={scopes.includes(scope)}
                  onCheckedChange={() => toggleScope(scope)}
                  className="dur-fast mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-border-strong bg-bg-inset outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[state=checked]:border-accent data-[state=checked]:bg-accent"
                >
                  <RadixCheckbox.Indicator>
                    <Check aria-hidden="true" className="size-2.5 text-accent-contrast" />
                  </RadixCheckbox.Indicator>
                </RadixCheckbox.Root>
                <span className="flex flex-col">
                  <span className="font-medium">{API_KEY_SCOPE_LABELS[scope]}</span>
                  <span className="text-micro text-text-muted">
                    {API_KEY_SCOPE_DESCRIPTIONS[scope]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <Input
            label="Expires"
            type="date"
            value={expiresAt}
            hint="Leave empty for a non-expiring key (not recommended for CI)."
            onChange={(event) => setExpiresAt(event.target.value)}
          />

          {scopes.length === 0 ? (
            <p role="alert" className="text-micro text-danger">
              Select at least one scope.
            </p>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={secret !== null}
        onOpenChange={(next) => {
          if (!next) setSecret(null);
        }}
        size="sm"
        title="Copy your API key now"
        description="This is the only time the secret is shown. If you lose it, revoke the key and create a new one."
        footer={
          <Button variant="secondary" size="sm" onClick={() => setSecret(null)}>
            I have stored it
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          <code className="mono break-all rounded-input border border-warn/40 bg-warn-subtle px-2 py-1.5 text-12 text-text">
            {secret ?? ''}
          </code>
          <Button
            size="sm"
            variant="secondary"
            iconLeft={Copy}
            className="w-fit"
            onClick={() => {
              // `navigator.clipboard` is non-optional in the DOM types and is present on
              // every secure origin; this app only runs on https and localhost.
              void navigator.clipboard.writeText(secret ?? '');
              toast({ title: 'API key copied' });
            }}
          >
            Copy key
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
