import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, UserRole } from "@/lib/AuthContext";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
}

/**
 * Wraps a route so it requires authentication, and optionally
 * restricts access to specific roles (mirrors the backend's
 * `authorize(...)` middleware — the frontend check is for UX only;
 * the backend is the real enforcement point).
 */
export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Access restricted</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your role ({user.role}) does not have permission to view this page.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
