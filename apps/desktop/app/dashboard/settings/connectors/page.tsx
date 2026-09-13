"use client";

import { AdminProvider } from "@repo/admin/provider";
import { ConnectorsSection } from "@repo/admin/settings/sections/connectors-section";
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
        <SettingsSkeleton active="connectors" />
      ) : (
        <SettingsShell active="connectors">
          <ConnectorsSection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
