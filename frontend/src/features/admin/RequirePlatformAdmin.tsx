import type { JSX, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '@/stores/session';
import { ROUTES } from '@/lib/constants';

/**
 * Client-side gate for the platform-admin surface.
 *
 * This is a UX guard, not a security boundary: the server enforces the allowlist on
 * every `/api/admin/*` call. Its job is to stop a non-admin from seeing a page that
 * would only render 403s.
 */
export default function RequirePlatformAdmin({ children }: { children: ReactNode }): JSX.Element {
  const user = useCurrentUser();
  if (user?.isPlatformAdmin !== true) {
    return <Navigate to={ROUTES.home} replace />;
  }
  return <>{children}</>;
}
