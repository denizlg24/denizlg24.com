import { AppearanceSection } from "@repo/admin/settings/sections/appearance-section";
import { SettingsShell } from "@repo/admin/settings/settings-shell";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SettingsShell active="appearance">
        <AppearanceSection />
      </SettingsShell>
    </AdminFeatureShell>
  );
}
