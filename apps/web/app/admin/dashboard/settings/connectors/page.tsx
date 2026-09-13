import { ConnectorsSection } from "@repo/admin/settings/sections/connectors-section";
import { SettingsShell } from "@repo/admin/settings/settings-shell";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SettingsShell active="connectors">
        <ConnectorsSection />
      </SettingsShell>
    </AdminFeatureShell>
  );
}
