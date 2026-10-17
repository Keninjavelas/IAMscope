import {
  Component,
  lazy,
  Suspense,
  useEffect,
  type ErrorInfo,
  type ReactNode,
  type JSX,
} from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError } from '@/api/client';
// Statically imported on purpose: a lazy guard wrapping a lazy page makes the route
// element suspend twice during a synchronous navigation, which React rejects with
// error #426 ("a component suspended while responding to synchronous input").
// The guard is ~1KB of logic, so there is nothing to gain from splitting it.
import RequirePlatformAdmin from '@/features/admin/RequirePlatformAdmin';
import { useMe } from '@/api/queries/auth';
import { ARIAAnnouncer } from '@/components/app/ARIAAnnouncer';
import { AppShell } from '@/components/app/AppShell';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastToaster } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { usePresence } from '@/hooks/usePresence';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useSSE } from '@/hooks/useSSE';
import { useTheme } from '@/hooks/useTheme';
import { ROUTES } from '@/lib/constants';
import {
  useActiveOrgId,
  useCurrentUser,
  useSessionHydrated,
  useSessionStore,
} from '@/stores/session';

/* ------------------------------------------------------------------ */
/* Route modules - one chunk each (Plan §20)                           */
/* ------------------------------------------------------------------ */

const HomePage = lazy(() => import('@/pages/HomePage'));
const ArchitecturePage = lazy(() => import('@/pages/ArchitecturePage'));
const DataModelPage = lazy(() => import('@/pages/DataModelPage'));
const AboutPage = lazy(() => import('@/pages/AboutPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const SignupPage = lazy(() => import('@/features/auth/SignupPage'));
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('@/features/auth/VerifyEmailPage'));

const CreateOrgPage = lazy(() => import('@/features/orgs/CreateOrgPage'));
const OrgSettingsPage = lazy(() => import('@/features/orgs/OrgSettingsPage'));
const MembersPage = lazy(() => import('@/features/orgs/MembersPage'));
const InvitationsPage = lazy(() => import('@/features/orgs/InvitationsPage'));
const ApiKeysPage = lazy(() => import('@/features/orgs/ApiKeysPage'));

const AdminUsersPage = lazy(() => import('@/features/admin/AdminUsersPage'));
const PoliciesPage = lazy(() => import('@/features/policies/PoliciesPage'));
const PolicyDetailPage = lazy(() => import('@/features/policies/PolicyDetailPage'));
const PolicyVersionsPage = lazy(() => import('@/features/policies/PolicyVersionsPage'));

const PrincipalsPage = lazy(() => import('@/features/principals/PrincipalsPage'));
const PrincipalDetailPage = lazy(() => import('@/features/principals/PrincipalDetailPage'));
const ResourcesPage = lazy(() => import('@/features/resources/ResourcesPage'));
const ScenariosPage = lazy(() => import('@/features/scenarios/ScenariosPage'));

const EvaluatePage = lazy(() => import('@/features/evaluate/EvaluatePage'));
const ImpactPage = lazy(() => import('@/features/impact/ImpactPage'));
const GraphPage = lazy(() => import('@/features/graph/GraphPage'));
const TimelinePage = lazy(() => import('@/features/timeline/TimelinePage'));
const AuditPage = lazy(() => import('@/features/audit/AuditPage'));

/* ------------------------------------------------------------------ */
/* Query client                                                       */
/* ------------------------------------------------------------------ */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});

/* ------------------------------------------------------------------ */
/* Fallbacks                                                          */
/* ------------------------------------------------------------------ */

/** Heights mirror the real page chrome so the swap causes zero layout shift. */
function PageSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-10 w-full rounded-card" />
      <div className="panel flex flex-col overflow-hidden">
        {Array.from({ length: 10 }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 border-b border-border-subtle px-3 last:border-b-0"
            style={{ height: 'var(--row-height)' }}
          >
            <Skeleton className="h-3 flex-[2]" />
            <Skeleton className="h-3 flex-[3]" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RouteBoundary({ children }: { children: ReactNode }): JSX.Element {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

/* ------------------------------------------------------------------ */
/* Error boundary                                                     */
/* ------------------------------------------------------------------ */

interface ErrorBoundaryState {
  error: unknown;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[IAMScope] render error', error, info.componentStack);
    }
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="mx-auto max-w-[720px] p-6">
        <ErrorState
          error={this.state.error}
          title="This page crashed"
          onRetry={() => this.setState({ error: null })}
          action={
            <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
              Reload IAMScope
            </Button>
          }
        />
      </div>
    );
  }
}

/* ------------------------------------------------------------------ */
/* Session provider (Plan §17)                                        */
/* ------------------------------------------------------------------ */

/**
 * Single owner of `/auth/me`, the SSE stream and the presence heartbeat, so the
 * header, the stores and every page agree about who is signed in.
 */
function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const client = useQueryClient();
  const applyMe = useSessionStore((state) => state.applyMe);
  const applyMeFailure = useSessionStore((state) => state.applyMeFailure);
  const clear = useSessionStore((state) => state.clear);
  const hydrated = useSessionStore((state) => state.hydrated);
  const orgId = useActiveOrgId();

  const me = useMe();

  useEffect(() => {
    if (me.isSuccess) applyMe(me.data);
  }, [applyMe, me.data, me.isSuccess]);

  useEffect(() => {
    if (!me.isError) return;
    const error = me.error;
    if (error.isUnauthenticated || error.isForbidden) {
      // Anonymous is a valid state, not an error.
      clear();
      client.clear();
      return;
    }
    applyMeFailure(error.message);
  }, [applyMeFailure, clear, client, me.error, me.isError]);

  useSSE({ enabled: hydrated });
  usePresence({ enabled: hydrated && orgId !== null });

  return <>{children}</>;
}

/* ------------------------------------------------------------------ */
/* Guards (Plan §16)                                                  */
/* ------------------------------------------------------------------ */

/** Redirects to `/login?next=…` while preserving the intended target. */
function RequireAuth(): JSX.Element {
  const hydrated = useSessionHydrated();
  const user = useCurrentUser();
  const location = useLocation();

  if (!hydrated) return <PageSkeleton />;
  if (user === null) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`${ROUTES.login}?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

export interface RequireRoleProps {
  min: 'viewer' | 'member' | 'admin' | 'owner';
  children: ReactNode;
}

/** Shows a recovery state instead of redirecting, so the URL stays meaningful. */
function RequireRole({ min, children }: RequireRoleProps): JSX.Element {
  const hasRole = useSessionStore((state) => state.hasRole);
  const role = useSessionStore((state) => state.role);

  if (role !== null && hasRole(min)) return <>{children}</>;

  const error = new ApiError({
    code: 'FORBIDDEN',
    message: `This page needs the ${min} role or higher in the active organization.`,
    status: 403,
  });

  return (
    <div className="panel">
      <ErrorState
        error={error}
        title="You do not have access"
        action={
          <Button variant="secondary" size="sm" onClick={() => window.history.back()}>
            Go back
          </Button>
        }
      />
    </div>
  );
}

/** Bare frame for the auth pages: no sidebar, still themed. */
function PublicFrame({ children }: { children: ReactNode }): JSX.Element {
  return <div className="min-h-full bg-bg">{children}</div>;
}

function NotFoundFrame(): JSX.Element {
  return <NotFoundPage />;
}

/* ------------------------------------------------------------------ */
/* App                                                                */
/* ------------------------------------------------------------------ */

export default function App(): JSX.Element {
  // Bootstraps: mirror reduced-motion onto <html> and apply theme/density/accent
  // in case the inline pre-paint script in index.html could not run.
  useReducedMotion();
  useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider delayDuration={400}>
          <SessionProvider>
            <AppErrorBoundary>
              <Routes>
                {/* ---- Public, rendered without the shell ---- */}
                <Route
                  path={ROUTES.login}
                  element={
                    <PublicFrame>
                      <RouteBoundary>
                        <LoginPage />
                      </RouteBoundary>
                    </PublicFrame>
                  }
                />
                <Route
                  path={ROUTES.signup}
                  element={
                    <PublicFrame>
                      <RouteBoundary>
                        <SignupPage />
                      </RouteBoundary>
                    </PublicFrame>
                  }
                />
                <Route
                  path={ROUTES.forgotPassword}
                  element={
                    <PublicFrame>
                      <RouteBoundary>
                        <ForgotPasswordPage />
                      </RouteBoundary>
                    </PublicFrame>
                  }
                />
                <Route
                  path={ROUTES.resetPassword}
                  element={
                    <PublicFrame>
                      <RouteBoundary>
                        <ResetPasswordPage />
                      </RouteBoundary>
                    </PublicFrame>
                  }
                />
                <Route
                  path={ROUTES.verifyEmail}
                  element={
                    <PublicFrame>
                      <RouteBoundary>
                        <VerifyEmailPage />
                      </RouteBoundary>
                    </PublicFrame>
                  }
                />

                {/* ---- Shell: Home + reference docs are readable anonymously ---- */}
                <Route element={<AppShell />}>
                  <Route
                    path={ROUTES.home}
                    element={
                      <RouteBoundary>
                        <HomePage />
                      </RouteBoundary>
                    }
                  />
                  <Route
                    path={ROUTES.architecture}
                    element={
                      <RouteBoundary>
                        <ArchitecturePage />
                      </RouteBoundary>
                    }
                  />
                  <Route
                    path={ROUTES.dataModel}
                    element={
                      <RouteBoundary>
                        <DataModelPage />
                      </RouteBoundary>
                    }
                  />
                  <Route
                    path={ROUTES.about}
                    element={
                      <RouteBoundary>
                        <AboutPage />
                      </RouteBoundary>
                    }
                  />

                  {/* ---- Everything below requires a session ---- */}
                  <Route element={<RequireAuth />}>
                    <Route
                      path={ROUTES.orgNew}
                      element={
                        <RouteBoundary>
                          <CreateOrgPage />
                        </RouteBoundary>
                      }
                    />

                    <Route
                      path={ROUTES.orgSettings}
                      element={
                        <RequireRole min="admin">
                          <RouteBoundary>
                            <OrgSettingsPage />
                          </RouteBoundary>
                        </RequireRole>
                      }
                    />
                    <Route
                      path={ROUTES.orgMembers}
                      element={
                        <RequireRole min="admin">
                          <RouteBoundary>
                            <MembersPage />
                          </RouteBoundary>
                        </RequireRole>
                      }
                    />
                    <Route
                      path={ROUTES.orgInvitations}
                      element={
                        <RequireRole min="admin">
                          <RouteBoundary>
                            <InvitationsPage />
                          </RouteBoundary>
                        </RequireRole>
                      }
                    />
                    <Route
                      path={ROUTES.orgApiKeys}
                      element={
                        <RequireRole min="admin">
                          <RouteBoundary>
                            <ApiKeysPage />
                          </RouteBoundary>
                        </RequireRole>
                      }
                    />

                    <Route
                      path={ROUTES.adminUsers}
                      element={
                        <RequirePlatformAdmin>
                          <AdminUsersPage />
                        </RequirePlatformAdmin>
                      }
                    />
                    <Route
                      path={ROUTES.policies}
                      element={
                        <RouteBoundary>
                          <PoliciesPage />
                        </RouteBoundary>
                      }
                    />
                    <Route
                      path={ROUTES.policyDetail}
                      element={
                        <RouteBoundary>
                          <PolicyDetailPage />
                        </RouteBoundary>
                      }
                    />
                    <Route
                      path={ROUTES.policyVersions}
                      element={
                        <RouteBoundary>
                          <PolicyVersionsPage />
                        </RouteBoundary>
                      }
                    />

                    <Route
                      path={ROUTES.principals}
                      element={
                        <RouteBoundary>
                          <PrincipalsPage />
                        </RouteBoundary>
                      }
                    />
                    <Route
                      path={ROUTES.principalDetail}
                      element={
                        <RouteBoundary>
                          <PrincipalDetailPage />
                        </RouteBoundary>
                      }
                    />
                    <Route
                      path={ROUTES.resources}
                      element={
                        <RouteBoundary>
                          <ResourcesPage />
                        </RouteBoundary>
                      }
                    />
                    <Route
                      path={ROUTES.scenarios}
                      element={
                        <RouteBoundary>
                          <ScenariosPage />
                        </RouteBoundary>
                      }
                    />

                    <Route
                      path={ROUTES.evaluate}
                      element={
                        <RouteBoundary>
                          <EvaluatePage />
                        </RouteBoundary>
                      }
                    />
                    <Route
                      path={ROUTES.impact}
                      element={
                        <RouteBoundary>
                          <ImpactPage />
                        </RouteBoundary>
                      }
                    />
                    <Route
                      path={ROUTES.graph}
                      element={
                        <RouteBoundary>
                          <GraphPage />
                        </RouteBoundary>
                      }
                    />
                    <Route
                      path={ROUTES.timeline}
                      element={
                        <RouteBoundary>
                          <TimelinePage />
                        </RouteBoundary>
                      }
                    />
                    <Route
                      path={ROUTES.audit}
                      element={
                        <RouteBoundary>
                          <AuditPage />
                        </RouteBoundary>
                      }
                    />
                  </Route>

                  <Route
                    path="*"
                    element={
                      <RouteBoundary>
                        <NotFoundFrame />
                      </RouteBoundary>
                    }
                  />
                </Route>
              </Routes>
            </AppErrorBoundary>
          </SessionProvider>

          <ToastToaster />
          <ARIAAnnouncer />
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
