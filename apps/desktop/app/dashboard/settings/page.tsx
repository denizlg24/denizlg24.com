"use client";

import { AdminProvider } from "@repo/admin/provider";
import { SettingsSkeleton } from "@repo/admin/settings/settings-shell";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

// Static export can't emit a server redirect, so the index swaps itself for the
// first section on mount and leaves no history entry behind.
export default function SettingsIndexPage() {
  const router = useRouter();
  const { value } = useDesktopAdmin();

  useEffect(() => {
    router.replace("/dashboard/settings/general");
  }, [router]);

  return (
    <AdminProvider value={value}>
      <SettingsSkeleton active="general" />
    </AdminProvider>
  );
}
