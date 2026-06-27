"use client";

import { InboxPage, InboxSkeleton } from "@repo/admin/inbox/inbox-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function InboxRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <InboxSkeleton /> : <InboxPage />}
    </AdminProvider>
  );
}
