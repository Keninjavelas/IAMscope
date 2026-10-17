import type { JSX, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useCurrentUser, useSessionHydrated } from '@/stores/session';
import { ROUTES } from '@/lib/constants';

/**
 * Client-side gate for the platform-admin surface.
 *
 * This is a UX guard, not a security boundary: the server enforces the allowlist on
 * every `/api/admin/*` call. Its job is to stop a non-admin from seeing a page that
 * would only render 403s.
 *
 * It MUST wait for session hydration. On a hard load (a bookmark, a refresh, or a
 * screenshot run) `/auth/me` is still in flight when this first renders, so the user
 * is momentarily `null`; redirecting on that would bounce a real admin to the home
 * page every time they open the URL directly.
 */
export default function RequirePlatformAdmin({ children }: { children: ReactNode }): JSX.Element {
  const user = useCurrentUser();
  const hydrated = useSessionHydrated();

  if (!hydrated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
        <span className="text-13 flex items-center gap-2 text-text-muted">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          Checking access…
        </span>
      </div>
    );
  }

  if (user?.isPlatformAdmin !== true) {
    return <Navigate to={ROUTES.home} replace />;
  }

  return <>{children}</>;
}
