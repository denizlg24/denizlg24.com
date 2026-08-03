import { AgentTasksPage } from "@repo/admin/agent-tasks/agent-tasks-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <AgentTasksPage />
    </AdminFeatureShell>
  );
}
