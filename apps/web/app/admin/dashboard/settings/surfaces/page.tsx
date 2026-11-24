import { SurfacesSection } from "@repo/admin/settings/sections/surfaces-section";
import { SettingsShell } from "@repo/admin/settings/settings-shell";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SettingsShell active="surfaces">
        <SurfacesSection />
      </SettingsShell>
    </AdminFeatureShell>
  );
}
