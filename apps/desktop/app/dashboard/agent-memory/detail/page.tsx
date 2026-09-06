"use client";

import { AgentMemoryDetailPage } from "@repo/admin/agent-memory/agent-memory-detail-page";
import { AdminRecordRoute } from "@/components/admin-route";

export default function AgentMemoryDetailRoute() {
  return (
    <AdminRecordRoute redirectTo="/dashboard/agent-memory">
      {(id) => <AgentMemoryDetailPage memoryId={id} />}
    </AdminRecordRoute>
  );
}
