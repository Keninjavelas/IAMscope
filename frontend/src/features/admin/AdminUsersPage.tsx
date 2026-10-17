import { useEffect, useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import type { Paginated, UserStatus } from '@iamscope/types';
import { api, isApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/* Contract                                                           */
/* ------------------------------------------------------------------ */

interface AdminUserOrg {
  orgId: string;
  orgName: string;
  role: string;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  orgs: AdminUserOrg[];
}

type StatusFilter = 'active' | 'suspended' | 'deleted' | 'all';

const PAGE_SIZES = [25, 50, 100] as const;

const STATUS_STYLES: Record<UserStatus, string> = {
  active: 'border-success/40 bg-success-subtle text-success',
  suspended: 'border-warn/40 bg-warn-subtle text-warn',
  deleted: 'border-danger/40 bg-danger-subtle text-danger',
};

function formatDate(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().slice(0, 10);
}

function messageOf(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message !== '') return error.message;
  return 'The request failed.';
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function AdminUsersPage(): JSX.Element {
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [status, setStatus] = useState<StatusFilter>('active');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AdminUserRow | null>(null);

  // 300ms debounce: typing an address should not fire a request per keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(term.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [term]);

  // Any filter change resets to the first page, otherwise a narrow filter can land
  // on an empty page and look like a failure.
  useEffect(() => {
    setPage(1);
  }, [debounced, status, pageSize]);

  const queryKey = useMemo(
    () => ['admin', 'users', { page, pageSize, status, q: debounced }] as const,
    [page, pageSize, status, debounced],
  );

  const list = useQuery<Paginated<AdminUserRow>>({
    queryKey,
    queryFn: ({ signal }) =>
      api.get<Paginated<AdminUserRow>>(
        '/admin/users',
        { page, pageSize, status, ...(debounced === '' ? {} : { q: debounced }) },
        { signal },
      ),
    staleTime: 15_000,
  });

  /** Patches every cached page of the list so an optimistic change is visible at once. */
  const patchCachedRows = (id: string, next: Partial<AdminUserRow>): (() => void) => {
    const snapshots = queryClient.getQueriesData<Paginated<AdminUserRow>>({
      queryKey: ['admin', 'users'],
    });
    queryClient.setQueriesData<Paginated<AdminUserRow>>(
      { queryKey: ['admin', 'users'] },
      (current) =>
        current === undefined
          ? current
          : {
              ...current,
              items: current.items.map((row) => (row.id === id ? { ...row, ...next } : row)),
            },
    );
    return () => {
      for (const [key, value] of snapshots) queryClient.setQueryData(key, value);
    };
  };

  const setStatusMutation = useMutation({
    mutationFn: (input: { id: string; status: 'active' | 'suspended' }) =>
      api.patch<AdminUserRow>(`/admin/users/${input.id}/status`, { status: input.status }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['admin', 'users'] });
      const rollback = patchCachedRows(input.id, { status: input.status });
      return { rollback };
    },
    onError: (_error, _input, context) => {
      context?.rollback();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/admin/users/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['admin', 'users'] });
      const rollback = patchCachedRows(id, { status: 'deleted' });
      return { rollback };
    },
    onError: (_error, _id, context) => {
      context?.rollback();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const mutationError = setStatusMutation.error ?? deleteMutation.error;
  const busy = setStatusMutation.isPending || deleteMutation.isPending;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-24 font-semibold tracking-tight text-text">Accounts</h1>
          <p className="text-13 mt-1 text-text-muted">
            Every account across all organizations. Changes are audited and take effect immediately.
          </p>
        </div>
        <span className="text-12 tabular rounded-full border border-border bg-bg-raised px-2.5 py-1 text-text-muted">
          {total} {total === 1 ? 'account' : 'accounts'}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle"
          />
          <Input
            aria-label="Search accounts by email or name"
            placeholder="Search email or name…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="pl-8"
          />
        </div>

        <label className="flex items-center gap-2">
          <span className="text-12 text-text-subtle">Status</span>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            className="text-13 h-8 rounded-input border border-border bg-bg-inset px-2 text-text outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deleted">Deleted</option>
            <option value="all">All</option>
          </select>
        </label>

        <label className="flex items-center gap-2">
          <span className="text-12 text-text-subtle">Rows</span>
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="text-13 h-8 rounded-input border border-border bg-bg-inset px-2 text-text outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mutationError !== null ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-input border border-danger/40 bg-danger-subtle px-3 py-2"
        >
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-danger" />
          <p className="text-13 text-danger">{messageOf(mutationError)}</p>
          <Button
            size="sm"
            variant="secondary"
            iconLeft={RefreshCw}
            onClick={() => {
              setStatusMutation.reset();
              deleteMutation.reset();
              void list.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-panel border border-border bg-bg-raised">
        <table className="w-full min-w-[860px] border-collapse">
          <caption className="sr-only">
            All accounts, with status and organization memberships
          </caption>
          <thead>
            <tr className="border-b border-border">
              {['Email', 'Name', 'Status', 'Orgs', 'Created', 'Last login', 'Actions'].map(
                (heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="text-11 px-3 py-2 text-left font-semibold tracking-wide text-text-subtle uppercase"
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8">
                  <span
                    className="text-13 flex items-center justify-center gap-2 text-text-muted"
                    role="status"
                  >
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    Loading accounts…
                  </span>
                </td>
              </tr>
            ) : list.isError ? (
              <tr>
                <td colSpan={7} className="px-3 py-8">
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-13 text-danger" role="alert">
                      {messageOf(list.error)}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      iconLeft={RefreshCw}
                      onClick={() => void list.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-13 px-3 py-8 text-center text-text-muted">
                  No users match this filter.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border-subtle last:border-0 hover:bg-bg-hover"
                >
                  <td className="px-3 py-2">
                    <span className="text-13 mono block text-text">{row.email}</span>
                    {row.emailVerified ? null : (
                      <span className="text-11 text-warn">Unverified</span>
                    )}
                  </td>
                  <td className="text-13 px-3 py-2 text-text-muted">{row.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'text-11 inline-flex items-center rounded-full border px-2 py-0.5 font-medium capitalize',
                        STATUS_STYLES[row.status],
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {row.orgs.length === 0 ? (
                      <span className="text-12 text-text-subtle">none</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {row.orgs.map((org) => (
                          <span
                            key={org.orgId}
                            className="text-11 rounded border border-border bg-bg-inset px-1.5 py-0.5 text-text-muted"
                            title={`${org.role} of ${org.orgName}`}
                          >
                            {org.orgName}
                            <span className="text-text-subtle"> · {org.role}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="text-12 tabular px-3 py-2 text-text-muted">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="text-12 tabular px-3 py-2 text-text-muted">
                    {formatDate(row.lastLoginAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {row.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          iconLeft={UserX}
                          disabled={busy}
                          onClick={() =>
                            setStatusMutation.mutate({ id: row.id, status: 'suspended' })
                          }
                        >
                          Suspend
                        </Button>
                      ) : row.status === 'suspended' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          iconLeft={UserCheck}
                          disabled={busy}
                          onClick={() => setStatusMutation.mutate({ id: row.id, status: 'active' })}
                        >
                          Unsuspend
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        iconLeft={Trash2}
                        disabled={busy || row.status === 'deleted'}
                        onClick={() => setPendingDelete(row)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-12 text-text-subtle">
          Page {page} of {pageCount}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1 || list.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pageCount || list.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </footer>

      <DeleteUserDialog
        target={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={(id) => {
          deleteMutation.mutate(id, {
            onSuccess: () => setPendingDelete(null),
          });
        }}
        pending={deleteMutation.isPending}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Delete confirmation                                                */
/* ------------------------------------------------------------------ */

interface DeleteUserDialogProps {
  target: AdminUserRow | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
  pending: boolean;
}

/**
 * Typing the address is the confirmation. A plain "are you sure" is too easy to click
 * through for an action that revokes every session and hides the account.
 */
function DeleteUserDialog({
  target,
  onClose,
  onConfirm,
  pending,
}: DeleteUserDialogProps): JSX.Element {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (target !== null) setTyped('');
  }, [target]);

  const matches = target !== null && typed.trim().toLowerCase() === target.email.toLowerCase();

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title="Delete this account?"
      description="The account is soft-deleted, every session is revoked, and the record is kept for audit."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!matches || pending}
            loading={pending}
            onClick={() => {
              if (target !== null && matches) onConfirm(target.id);
            }}
          >
            Delete account
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="inset-surface flex items-start gap-2.5 p-3">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="text-13 text-text-muted">
            This revokes {target?.email ?? 'the account'}&apos;s sessions immediately. Type the
            email to confirm.
          </p>
        </div>
        <Input
          aria-label="Type the account email to confirm deletion"
          placeholder={target?.email ?? ''}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
        />
      </div>
    </Dialog>
  );
}
