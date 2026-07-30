import { GeneralSection } from "@repo/admin/settings/sections/general-section";
import { SettingsShell } from "@repo/admin/settings/settings-shell";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SettingsShell active="general">
        <GeneralSection />
      </SettingsShell>
    </AdminFeatureShell>
  );
}
