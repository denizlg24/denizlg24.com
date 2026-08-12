"use client";

import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";
import { ChatView } from "./_components/chat-view";
import { DashboardSummary } from "./_components/dashboard-summary";

export default function Home() {
  const { value, loading } = useDesktopAdmin();
  if (loading) return null;
  return (
    <AdminProvider value={value}>
      <ChatView summary={<DashboardSummary />} />
    </AdminProvider>
  );
}
