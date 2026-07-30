"use client";

import { AdminProvider } from "@repo/admin/provider";
import { ModelsSection } from "@repo/admin/settings/sections/models-section";
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
        <SettingsSkeleton active="models" />
      ) : (
        <SettingsShell active="models">
          <ModelsSection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
