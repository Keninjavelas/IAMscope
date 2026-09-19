import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiKey, ApiKeyScope, Invitation, Membership, Org, Role } from '@iamscope/types';
import { MOTION } from '@iamscope/tokens';
import { api, type ApiError } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useToast } from '@/components/ui/Toast';
import { useActiveOrgId, useSessionStore } from '@/stores/session';
import { noOrgError, removeFromPages, takeSnapshot } from './shared';

/* ------------------------------------------------------------------ */
/* Org CRUD                                                           */
/* ------------------------------------------------------------------ */

export function useCreateOrg() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (payload: { name: string; slug?: string }) => api.post<Org>('/orgs', payload),
    onSuccess: (org) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.root() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
      toast.success('Organization created', org.name);
    },
    onError: (error: ApiError) => {
      toast.error('Could not create organization', error.message);
    },
  });
}

export function useUpdateOrg() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const key = queryKeys.orgs.detail(orgId ?? 'none');

  return useMutation({
    mutationFn: (payload: { name?: string; settings?: Partial<Org['settings']> }) => {
      if (orgId === null) throw noOrgError();
      return api.put<Org>(`/orgs/${orgId}`, payload);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Org>(key);
      const listSnapshot = takeSnapshot(queryClient, { queryKey: queryKeys.orgs.list() });
      if (previous) {
        const next: Org = {
          ...previous,
          ...(payload.name === undefined ? {} : { name: payload.name }),
          ...(payload.settings === undefined
            ? {}
            : { settings: { ...previous.settings, ...payload.settings } }),
        };
        queryClient.setQueryData<Org>(key, next);
        queryClient.setQueryData<Org[]>(queryKeys.orgs.list(), (old) =>
          (old ?? []).map((org) => (org.id === next.id ? next : org)),
        );
        // The switch-org menu and header read from the session store.
        useSessionStore.getState().setActiveOrg(next);
        useSessionStore
          .getState()
          .setOrgs(useSessionStore.getState().orgs.map((org) => (org.id === next.id ? next : org)));
      }
      return { previous, listSnapshot };
    },
    onError: (error: ApiError, _payload, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      if (context) {
        for (const [queryKey, data] of context.listSnapshot)
          queryClient.setQueryData(queryKey, data);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
      toast.error('Could not save organization', error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.root() });
    },
  });
}

export function useDeleteOrg() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();

  return useMutation({
    mutationFn: (id: string) => api.delete<null>(`/orgs/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.orgs.root() });
      const snapshot = takeSnapshot(queryClient, { queryKey: queryKeys.orgs.root() });
      queryClient.setQueryData<Org[]>(queryKeys.orgs.list(), (old) =>
        (old ?? []).filter((org) => org.id !== id),
      );
      if (orgId === id) {
        useSessionStore.getState().setActiveOrg(null);
        useSessionStore
          .getState()
          .setOrgs(useSessionStore.getState().orgs.filter((org) => org.id !== id));
      }
      return { snapshot, wasActive: orgId === id };
    },
    onError: (error: ApiError, _id, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
        void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
      }
      toast.error('Could not delete organization', error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
      queryClient.removeQueries({ queryKey: queryKeys.orgs.root() });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Invitations                                                        */
/* ------------------------------------------------------------------ */

export function useCreateInvitation() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();

  return useMutation({
    mutationFn: (payload: { email: string; role: Exclude<Role, 'owner'> }) => {
      if (orgId === null) throw noOrgError();
      return api.post<Invitation>(`/orgs/${orgId}/invitations`, payload);
    },
    onSuccess: (invitation) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.invitations(orgId ?? 'none') });
      toast.success('Invitation sent', invitation.email);
    },
    onError: (error: ApiError) => {
      toast.error('Could not invite member', error.message);
    },
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const key = queryKeys.orgs.invitations(orgId ?? 'none');

  return useMutation({
    mutationFn: (id: string) => {
      if (orgId === null) throw noOrgError();
      return api.delete<null>(`/orgs/${orgId}/invitations/${id}`);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Invitation[]>(key);
      const revoked = previous?.find((invitation) => invitation.id === id);
      queryClient.setQueryData<Invitation[]>(key, (old) =>
        (old ?? []).filter((invitation) => invitation.id !== id),
      );
      return { previous, revoked };
    },
    onError: (error: ApiError, _id, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
      toast.error('Could not revoke invitation', error.message);
    },
    onSuccess: (_data, _id, context) => {
      const revoked = context.revoked;
      if (!revoked) {
        toast.success('Invitation revoked');
        return;
      }
      toast.undoable({
        title: 'Invitation revoked',
        description: `${revoked.email} can no longer join with the old link.`,
        durationMs: MOTION.toastDurationMs,
        onUndo: () => {
          // Inverse mutation: issue a fresh invitation for the same address + role.
          void api
            .post<Invitation>(`/orgs/${orgId ?? ''}/invitations`, {
              email: revoked.email,
              role: revoked.role,
            })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: key });
              toast.success('Invitation re-issued');
            })
            .catch((error: unknown) => {
              toast.error(
                'Could not re-issue invitation',
                error instanceof Error ? error.message : undefined,
              );
            });
        },
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (payload: { token: string; name: string; password: string }) =>
      api.post<{ orgId: string }>(`/invitations/${payload.token}/accept`, {
        name: payload.name,
        password: payload.password,
      }),
    onSuccess: () => {
      queryClient.clear();
      toast.success('Welcome to the organization');
    },
    onError: (error: ApiError) => {
      toast.error('Could not accept invitation', error.message);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Members                                                            */
/* ------------------------------------------------------------------ */

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const prefix = ['orgs', orgId ?? 'none', 'members'] as const;

  return useMutation({
    mutationFn: (payload: { userId: string; role: Role }) => {
      if (orgId === null) throw noOrgError();
      return api.put<Membership>(`/orgs/${orgId}/members/${payload.userId}`, {
        role: payload.role,
      });
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: prefix });
      const snapshot = takeSnapshot(queryClient, { queryKey: prefix });
      queryClient.setQueriesData({ queryKey: prefix }, (old: unknown) =>
        replaceMembershipRole(old, payload.userId, payload.role),
      );
      return { snapshot };
    },
    onError: (error: ApiError, _payload, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
      }
      toast.error('Could not change role', error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: prefix });
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
    },
  });
}

function replaceMembershipRole(old: unknown, userId: string, role: Role): unknown {
  if (old === null || typeof old !== 'object') return old;
  const page = old as { items?: Membership[]; total?: number };
  if (!Array.isArray(page.items)) return old;
  return {
    ...page,
    items: page.items.map((member) => (member.userId === userId ? { ...member, role } : member)),
  };
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const prefix = ['orgs', orgId ?? 'none', 'members'] as const;

  return useMutation({
    mutationFn: (userId: string) => {
      if (orgId === null) throw noOrgError();
      return api.delete<null>(`/orgs/${orgId}/members/${userId}`);
    },
    onMutate: async (userId) => {
      await queryClient.cancelQueries({ queryKey: prefix });
      const snapshot = takeSnapshot(queryClient, { queryKey: prefix });
      const removed = findMember(snapshot, userId);
      queryClient.setQueriesData({ queryKey: prefix }, (old: unknown) =>
        removeFromPages(old, userId),
      );
      return { snapshot, removed };
    },
    onError: (error: ApiError, _userId, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
      }
      toast.error('Could not remove member', error.message);
    },
    onSuccess: (_data, _userId, context) => {
      const removed = context.removed;
      if (!removed) {
        toast.success('Member removed');
        return;
      }
      toast.undoable({
        title: 'Member removed',
        description: `${removed.user?.name ?? removed.userId} lost access to this organization.`,
        durationMs: MOTION.toastDurationMs,
        onUndo: () => {
          // Inverse mutation: restore the membership with its previous role.
          void api
            .put<Membership>(`/orgs/${orgId ?? ''}/members/${removed.userId}`, {
              role: removed.role,
            })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: prefix });
              toast.success('Member restored');
            })
            .catch((error: unknown) => {
              toast.error(
                'Could not restore member',
                error instanceof Error ? error.message : undefined,
              );
            });
        },
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: prefix });
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
    },
  });
}

function findMember(snapshot: ReturnType<typeof takeSnapshot>, userId: string): Membership | null {
  for (const [, data] of snapshot) {
    if (data === null || typeof data !== 'object') continue;
    const page = data as { items?: Membership[] };
    if (!Array.isArray(page.items)) continue;
    const match = page.items.find((member) => member.userId === userId);
    if (match) return match;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* API keys                                                           */
/* ------------------------------------------------------------------ */

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();

  return useMutation({
    mutationFn: (payload: { name: string; scopes: ApiKeyScope[]; expiresAt?: string | null }) => {
      if (orgId === null) throw noOrgError();
      return api.post<ApiKey>(`/orgs/${orgId}/api-keys`, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.apiKeys(orgId ?? 'none') });
      toast.success('API key created', 'Copy the secret now - it is shown once.');
    },
    onError: (error: ApiError) => {
      toast.error('Could not create API key', error.message);
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const key = queryKeys.orgs.apiKeys(orgId ?? 'none');

  return useMutation({
    mutationFn: (id: string) => {
      if (orgId === null) throw noOrgError();
      return api.delete<null>(`/orgs/${orgId}/api-keys/${id}`);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiKey[]>(key);
      const revoked = previous?.find((entry) => entry.id === id);
      queryClient.setQueryData<ApiKey[]>(key, (old) =>
        (old ?? []).filter((entry) => entry.id !== id),
      );
      return { previous, revoked };
    },
    onError: (error: ApiError, _id, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
      toast.error('Could not revoke API key', error.message);
    },
    onSuccess: (_data, _id, context) => {
      const revoked = context.revoked;
      if (!revoked) {
        toast.success('API key revoked');
        return;
      }
      toast.undoable({
        title: 'API key revoked',
        description: 'Clients using this key will start failing.',
        durationMs: MOTION.toastDurationMs,
        onUndo: () => {
          // A revoked key can never be un-revoked (only its hash is stored), so the
          // only honest "undo" is issuing an equivalent replacement key.
          void api
            .post<ApiKey>(`/orgs/${orgId ?? ''}/api-keys`, {
              name: revoked.name,
              scopes: revoked.scopes,
              expiresAt: revoked.expiresAt,
            })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: key });
              toast.success('Replacement key created', 'Copy the new secret - it is shown once.');
            })
            .catch((error: unknown) => {
              toast.error(
                'Could not create replacement key',
                error instanceof Error ? error.message : undefined,
              );
            });
        },
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
