import { FinanceSection } from "@repo/admin/settings/sections/finance-section";
import { SettingsShell } from "@repo/admin/settings/settings-shell";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SettingsShell active="finance">
        <FinanceSection />
      </SettingsShell>
    </AdminFeatureShell>
  );
}
