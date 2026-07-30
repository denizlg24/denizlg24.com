"use client";

import { AdminProvider } from "@repo/admin/provider";
import { AgentMemorySection } from "@repo/admin/settings/sections/agent-memory-section";
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
        <SettingsSkeleton active="agent-memory" />
      ) : (
        <SettingsShell active="agent-memory">
          <AgentMemorySection />
        </SettingsShell>
      )}
    </AdminProvider>
  );
}
