import { create } from 'zustand';
import type { AuthMeResponse, Org, Permission, Role, User } from '@iamscope/types';

const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

const NO_PERMISSIONS: Permission = {
  canRead: false,
  canWrite: false,
  canEvaluate: false,
  canAdmin: false,
  canDeleteOrg: false,
};

export interface SessionState {
  user: User | null;
  activeOrg: Org | null;
  orgs: Org[];
  role: Role | null;
  permissions: Permission;
  /** True once `/auth/me` has resolved (successfully or not) at least once. */
  hydrated: boolean;
  /** Set when the last `/auth/me` failed with a non-401 error. */
  error: string | null;

  applyMe: (me: AuthMeResponse) => void;
  applyMeFailure: (error: string | null) => void;
  setActiveOrg: (org: Org | null) => void;
  setOrgs: (orgs: Org[]) => void;
  clear: () => void;
  setRole: (role: Role | null) => void;

  hasRole: (min: Role) => boolean;
  orgId: () => string | null;
}

/**
 * Coarse role-derived flags. Used as the local fallback whenever the API has not
 * supplied `AuthMeResponse.permissions` (e.g. after an optimistic role change).
 */
function permissionsForRole(role: Role | null): Permission {
  if (role === null) return NO_PERMISSIONS;
  return {
    canRead: true,
    canWrite: ROLE_RANK[role] >= ROLE_RANK.member,
    canEvaluate: true,
    canAdmin: ROLE_RANK[role] >= ROLE_RANK.admin,
    canDeleteOrg: role === 'owner',
  };
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  user: null,
  activeOrg: null,
  orgs: [],
  role: null,
  permissions: NO_PERMISSIONS,
  hydrated: false,
  error: null,

  applyMe: (me) =>
    set({
      user: me.user,
      activeOrg: me.activeOrg,
      orgs: me.orgs,
      role: me.role,
      permissions: me.permissions,
      hydrated: true,
      error: null,
    }),

  applyMeFailure: (error) =>
    set({
      user: null,
      activeOrg: null,
      orgs: [],
      role: null,
      permissions: NO_PERMISSIONS,
      hydrated: true,
      error,
    }),

  setActiveOrg: (activeOrg) =>
    set((state) => {
      const role = activeOrg ? (activeOrg.role ?? state.role) : null;
      const permissions = permissionsForRole(role);
      return { activeOrg, role, permissions };
    }),

  setOrgs: (orgs) => set({ orgs }),

  setRole: (role) =>
    set({
      role,
      permissions: permissionsForRole(role),
    }),

  clear: () =>
    set({
      user: null,
      activeOrg: null,
      orgs: [],
      role: null,
      permissions: NO_PERMISSIONS,
      error: null,
      // `hydrated` stays true: we now know the answer is "anonymous".
      hydrated: true,
    }),

  hasRole: (min) => {
    const role = get().role;
    return role !== null && ROLE_RANK[role] >= ROLE_RANK[min];
  },

  orgId: () => get().activeOrg?.id ?? null,
}));

/* ------------------------------------------------------------------ */
/* Selector hooks - one per slice so components re-render narrowly.   */
/* ------------------------------------------------------------------ */

export const useCurrentUser = (): User | null => useSessionStore((state) => state.user);
export const useActiveOrg = (): Org | null => useSessionStore((state) => state.activeOrg);
export const useUserOrgs = (): Org[] => useSessionStore((state) => state.orgs);
export const useRole = (): Role | null => useSessionStore((state) => state.role);
export const usePermissions = (): Permission => useSessionStore((state) => state.permissions);
export const useSessionHydrated = (): boolean => useSessionStore((state) => state.hydrated);

export function useActiveOrgId(): string | null {
  return useSessionStore((state) => state.activeOrg?.id ?? null);
}

/**
 * Org-scoped query base. `useActiveOrgId` returns a primitive so it is safe as a
 * zustand selector (returning a fresh object from a selector re-renders forever
 * under `useSyncExternalStore`). Combine it with `useSessionReady` to gate queries.
 */
export function useSessionReady(): boolean {
  return useSessionStore((state) => state.hydrated);
}
