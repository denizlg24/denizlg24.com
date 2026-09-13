"use client";

import { AgentPanel } from "@repo/admin/agent/agent-panel";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";
import { DashboardSummary } from "./_components/dashboard-summary";

export default function Home() {
  const { value, loading } = useDesktopAdmin();
  if (loading) return null;
  return (
    <AdminProvider value={value}>
      <AgentPanel
        variant="page"
        allowBackground
        summary={<DashboardSummary />}
      />
    </AdminProvider>
  );
}
