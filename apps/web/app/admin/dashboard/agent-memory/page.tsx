import { AgentMemoryPage } from "@repo/admin/agent-memory/agent-memory-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <AgentMemoryPage />
    </AdminFeatureShell>
  );
}
