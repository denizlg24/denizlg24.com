"use client";

import { AdminProvider } from "@repo/admin/provider";
import { AppearanceSection } from "@repo/admin/settings/sections/appearance-section";
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
        <SettingsSkeleton active="appearance" />
      ) : (
        <SettingsShell active="appearance">
          <AppearanceSection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
