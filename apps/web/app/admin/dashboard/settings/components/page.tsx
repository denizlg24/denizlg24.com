import { ComponentsSection } from "@repo/admin/settings/sections/components-section";
import { SettingsShell } from "@repo/admin/settings/settings-shell";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SettingsShell active="components">
        <ComponentsSection />
      </SettingsShell>
    </AdminFeatureShell>
  );
}
