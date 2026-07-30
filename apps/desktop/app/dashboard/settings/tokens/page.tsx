"use client";

import { AdminProvider } from "@repo/admin/provider";
import { TokensSection } from "@repo/admin/settings/sections/tokens-section";
import {
  SettingsShell,
  SettingsSkeleton,
} from "@repo/admin/settings/settings-shell";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function Page() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? (
        <SettingsSkeleton active="tokens" />
      ) : (
        <SettingsShell active="tokens">
          <TokensSection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
