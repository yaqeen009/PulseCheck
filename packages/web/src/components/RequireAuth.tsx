import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useMe } from '@/api/auth';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/ui/skeleton';

function SessionSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-3" aria-busy="true" aria-live="polite">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

/**
 * Route guard for the authenticated area.
 *
 * `useMe` runs with `retry: false`; an unauthenticated visitor is redirected to
 * `/login` and the attempted path is passed along so the login form can return
 * there.
 */
export function RequireAuth() {
  const location = useLocation();
  const { data: user, isLoading, isError, error, refetch } = useMe();

  if (isLoading) return <SessionSkeleton />;

  if (isError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
        <ErrorState
          error={error}
          title="Could not reach the PulseCheck API"
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }

  return <Outlet />;
}

/** Keeps signed-in users away from the login and registration screens. */
export function RequireGuest() {
  const { data: user, isLoading } = useMe();

  if (isLoading) return <SessionSkeleton />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
