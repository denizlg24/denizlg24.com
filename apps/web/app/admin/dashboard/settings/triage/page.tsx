import { TriageSection } from "@repo/admin/settings/sections/triage-section";
import { SettingsShell } from "@repo/admin/settings/settings-shell";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SettingsShell active="triage">
        <TriageSection />
      </SettingsShell>
    </AdminFeatureShell>
  );
}
