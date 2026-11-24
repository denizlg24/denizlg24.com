"use client";

import { AdminProvider } from "@repo/admin/provider";
import { SurfacesSection } from "@repo/admin/settings/sections/surfaces-section";
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
        <SettingsSkeleton active="surfaces" />
      ) : (
        <SettingsShell active="surfaces">
          <SurfacesSection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
