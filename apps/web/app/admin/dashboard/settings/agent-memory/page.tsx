import { AgentMemorySection } from "@repo/admin/settings/sections/agent-memory-section";
import { SettingsShell } from "@repo/admin/settings/settings-shell";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SettingsShell active="agent-memory">
        <AgentMemorySection />
      </SettingsShell>
    </AdminFeatureShell>
  );
}
