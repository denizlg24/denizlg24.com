"use client";

import { AdminProvider } from "@repo/admin/provider";
import { FinanceSection } from "@repo/admin/settings/sections/finance-section";
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
        <SettingsSkeleton active="finance" />
      ) : (
        <SettingsShell active="finance">
          <FinanceSection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
