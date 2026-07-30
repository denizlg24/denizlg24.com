"use client";

import { AdminProvider } from "@repo/admin/provider";
import {
  SettingsShell,
  SettingsSkeleton,
} from "@repo/admin/settings/settings-shell";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";
import { DeviceSection } from "./_components/device-section";

export default function Page() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? (
        <SettingsSkeleton active="device" />
      ) : (
        <SettingsShell active="device">
          <DeviceSection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
