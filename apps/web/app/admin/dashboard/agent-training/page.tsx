import { AgentTrainingPage } from "@repo/admin/agent-training/agent-training-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <AgentTrainingPage />
    </AdminFeatureShell>
  );
}
