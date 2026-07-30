"use client";

import { AdminProvider } from "@repo/admin/provider";
import { TriageSection } from "@repo/admin/settings/sections/triage-section";
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
        <SettingsSkeleton active="triage" />
      ) : (
        <SettingsShell active="triage">
          <TriageSection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
