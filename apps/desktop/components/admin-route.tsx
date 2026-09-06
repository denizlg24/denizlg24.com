"use client";

import { AdminProvider } from "@repo/admin/provider";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect } from "react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

const FALLBACK = <div className="h-full animate-pulse bg-muted/20" />;

/**
 * Mounts a shared admin feature under the desktop provider.
 *
 * `fallback` renders while user settings (and therefore the API key) load;
 * without it the feature would mount with an unauthenticated client and fetch
 * a 401 on first paint.
 */
export function AdminRoute({
  fallback = FALLBACK,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>{loading ? fallback : children}</AdminProvider>
  );
}

function RecordRouteInner({
  param = "id",
  redirectTo,
  fallback,
  children,
}: {
  param?: string;
  redirectTo: string;
  fallback?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get(param);

  useEffect(() => {
    if (!id) router.replace(redirectTo);
  }, [id, redirectTo, router]);

  if (!id) return null;

  return <AdminRoute fallback={fallback}>{children(id)}</AdminRoute>;
}

/**
 * A desktop route addressing one record by query parameter.
 *
 * This app is a static export, so `/dashboard/blog/edit/[id]` has no page to
 * serve — the id arrives as `?id=` instead, which is why every detail route
 * here needs the `useSearchParams` Suspense boundary this wraps up.
 */
export function AdminRecordRoute(props: {
  param?: string;
  redirectTo: string;
  fallback?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  return (
    <Suspense fallback={props.fallback ?? FALLBACK}>
      <RecordRouteInner {...props} />
    </Suspense>
  );
}

function QueryRouteInner({
  fallback,
  children,
}: {
  fallback?: ReactNode;
  children: (params: URLSearchParams) => ReactNode;
}) {
  const searchParams = useSearchParams();
  return <AdminRoute fallback={fallback}>{children(searchParams)}</AdminRoute>;
}

/**
 * A desktop route whose query parameters are all optional — a list page that
 * also renders a detail when the URL names one, for instance.
 */
export function AdminQueryRoute(props: {
  fallback?: ReactNode;
  children: (params: URLSearchParams) => ReactNode;
}) {
  return (
    <Suspense fallback={props.fallback ?? FALLBACK}>
      <QueryRouteInner {...props} />
    </Suspense>
  );
}
