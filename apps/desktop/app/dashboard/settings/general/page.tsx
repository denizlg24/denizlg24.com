"use client";

import { AdminProvider } from "@repo/admin/provider";
import { GeneralSection } from "@repo/admin/settings/sections/general-section";
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
        <SettingsSkeleton active="general" />
      ) : (
        <SettingsShell active="general">
          <GeneralSection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
