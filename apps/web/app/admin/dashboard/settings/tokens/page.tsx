import { TokensSection } from "@repo/admin/settings/sections/tokens-section";
import { SettingsShell } from "@repo/admin/settings/settings-shell";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SettingsShell active="tokens">
        <TokensSection />
      </SettingsShell>
    </AdminFeatureShell>
  );
}
