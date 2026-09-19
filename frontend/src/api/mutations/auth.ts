import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { LoginResult, Session } from '@iamscope/types';
import { api, type ApiError } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useToast } from '@/components/ui/Toast';
import { useSessionStore } from '@/stores/session';
import { takeSnapshot, type Snapshot } from './shared';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Identity mutations change who we are, so every org-scoped cache is suspect.
 * Wiping the whole cache is correct here (and cheap: the app re-fetches lazily).
 */
function resetEverything(queryClient: QueryClient): void {
  queryClient.clear();
}

interface SessionSnapshot {
  user: ReturnType<typeof useSessionStore.getState>['user'];
  activeOrg: ReturnType<typeof useSessionStore.getState>['activeOrg'];
  orgs: ReturnType<typeof useSessionStore.getState>['orgs'];
  role: ReturnType<typeof useSessionStore.getState>['role'];
  permissions: ReturnType<typeof useSessionStore.getState>['permissions'];
  error: string | null;
}

function snapshotSession(): SessionSnapshot {
  const state = useSessionStore.getState();
  return {
    user: state.user,
    activeOrg: state.activeOrg,
    orgs: state.orgs,
    role: state.role,
    permissions: state.permissions,
    error: state.error,
  };
}

function restoreSession(snapshot: SessionSnapshot): void {
  useSessionStore.setState(snapshot);
}

/* ------------------------------------------------------------------ */
/* Login / signup / logout                                            */
/* ------------------------------------------------------------------ */

export function useLogin() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      api.post<LoginResult>('/auth/login', payload),
    onSuccess: () => {
      // `/auth/me` is the single source of truth for the session store.
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
      toast.success('Signed in');
    },
    onError: (error: ApiError) => {
      toast.error('Could not sign in', error.message);
    },
  });
}

export function useSignup() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    // Signup returns the same session envelope as login (Plan §9.1).
    mutationFn: (payload: { email: string; password: string; name: string; orgName: string }) =>
      api.post<LoginResult>('/auth/signup', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.list() });
      toast.success('Account created', 'Your organization is ready.');
    },
    onError: (error: ApiError) => {
      toast.error('Could not create account', error.message);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => api.post<null>('/auth/logout'),
    onMutate: () => {
      const snapshot = snapshotSession();
      useSessionStore.getState().clear();
      return { snapshot };
    },
    onError: (error: ApiError, _variables, context) => {
      if (context) restoreSession(context.snapshot);
      toast.error('Could not sign out', error.message);
    },
    onSettled: () => {
      resetEverything(queryClient);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Password + email                                                   */
/* ------------------------------------------------------------------ */

export function useForgotPassword() {
  const toast = useToast();
  return useMutation({
    mutationFn: (payload: { email: string }) =>
      api.post<{ resetToken?: string }>('/auth/forgot-password', payload),
    onSuccess: () => {
      toast.success('Check your inbox', 'If that address exists we sent a reset link.');
    },
    onError: (error: ApiError) => {
      toast.error('Could not send reset link', error.message);
    },
  });
}

export function useResetPassword() {
  const toast = useToast();
  return useMutation({
    mutationFn: (payload: { token: string; newPassword: string }) =>
      api.post<null>('/auth/reset-password', payload),
    onSuccess: () => {
      toast.success('Password updated', 'Sign in with your new password.');
    },
    onError: (error: ApiError) => {
      toast.error('Could not reset password', error.message);
    },
  });
}

export function useVerifyEmail() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (payload: { token: string }) =>
      api.post<{ verified: boolean }>('/auth/verify-email', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
      toast.success('Email verified');
    },
    onError: (error: ApiError) => {
      toast.error('Verification failed', error.message);
    },
  });
}

export function useChangePassword() {
  const toast = useToast();
  return useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string }) =>
      api.post<null>('/auth/change-password', payload),
    onSuccess: () => {
      toast.success('Password changed', 'Other sessions were rotated out.');
    },
    onError: (error: ApiError) => {
      toast.error('Could not change password', error.message);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Org switching + sessions                                           */
/* ------------------------------------------------------------------ */

export function useSwitchOrg() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (payload: { orgId: string }) =>
      api.post<{ role: string }>('/auth/switch-org', payload),
    onMutate: (variables) => {
      const previous = useSessionStore.getState().activeOrg;
      // Optimistic: the shell and the org switcher react immediately.
      const target =
        useSessionStore.getState().orgs.find((org) => org.id === variables.orgId) ?? null;
      if (target) useSessionStore.getState().setActiveOrg(target);
      return { previous };
    },
    onError: (error: ApiError, _variables, context) => {
      if (context?.previous !== undefined) {
        useSessionStore.getState().setActiveOrg(context.previous);
      }
      toast.error('Could not switch organization', error.message);
    },
    onSettled: () => {
      // Org-scoped caches are all keyed by orgId, but the role changed too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
    },
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = queryKeys.auth.sessions();

  return useMutation({
    mutationFn: (id: string) => api.delete<null>(`/auth/sessions/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot: Snapshot = takeSnapshot(queryClient, { queryKey: key });
      queryClient.setQueryData<Session[]>(key, (old) =>
        (old ?? []).filter((session) => session.id !== id),
      );
      return { snapshot };
    },
    onError: (error: ApiError, _id, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
      }
      toast.error('Could not revoke session', error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
