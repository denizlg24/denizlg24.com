import { SettingsPage } from "@repo/admin/settings/settings-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function SettingsAdminPage() {
  return (
    <AdminFeatureShell>
      <SettingsPage />
    </AdminFeatureShell>
  );
}
