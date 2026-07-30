import { ModelsSection } from "@repo/admin/settings/sections/models-section";
import { SettingsShell } from "@repo/admin/settings/settings-shell";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SettingsShell active="models">
        <ModelsSection />
      </SettingsShell>
    </AdminFeatureShell>
  );
}
