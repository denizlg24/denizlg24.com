import { AgentMemoryDetailPage } from "@repo/admin/agent-memory/agent-memory-detail-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Memory | Admin Dashboard",
};

export default async function AgentMemoryDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <AgentMemoryDetailPage memoryId={id} />
    </AdminFeatureShell>
  );
}
