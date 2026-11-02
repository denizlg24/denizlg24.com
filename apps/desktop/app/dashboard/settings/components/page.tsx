"use client";

import { AdminProvider } from "@repo/admin/provider";
import { ComponentsSection } from "@repo/admin/settings/sections/components-section";
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
        <SettingsSkeleton active="components" />
      ) : (
        <SettingsShell active="components">
          <ComponentsSection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
