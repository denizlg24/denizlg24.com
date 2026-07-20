"use client";

import {
  AgentTrainingPage,
  AgentTrainingSkeleton,
} from "@repo/admin/agent-training/agent-training-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function AgentTrainingRoute() {
  const { value, loading } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      {loading ? <AgentTrainingSkeleton /> : <AgentTrainingPage />}
    </AdminProvider>
  );
}
