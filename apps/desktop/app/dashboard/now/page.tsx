"use client";

import { NowPage, NowSkeleton } from "@repo/admin/now/now-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function NowRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <NowSkeleton /> : <NowPage />}
    </AdminProvider>
  );
}
