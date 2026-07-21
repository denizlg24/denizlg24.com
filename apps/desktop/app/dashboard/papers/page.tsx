"use client";

import { PapersPage, PapersSkeleton } from "@repo/admin/papers/papers-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function PapersRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <PapersSkeleton /> : <PapersPage />}
    </AdminProvider>
  );
}
