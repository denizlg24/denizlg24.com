"use client";

import { SettingsSkeleton } from "@repo/admin/settings/settings-shell";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Static export can't emit a server redirect, so the index swaps itself for the
// first section on mount and leaves no history entry behind.
export default function SettingsIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/settings/general");
  }, [router]);

  return <SettingsSkeleton active="general" />;
}
