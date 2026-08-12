"use client";

import { type AdminContextValue, AdminProvider } from "@repo/admin/provider";
import { useMemo } from "react";
import { createWebAdminClient } from "@/lib/admin-client";
import { webPlatform } from "@/lib/platform-bridge";
import { VoiceAssistant } from "./voice-assistant";

export function VoiceAssistantShell() {
  const value = useMemo<AdminContextValue>(
    () => ({
      client: createWebAdminClient(),
      platform: webPlatform,
      routes: {
        dashboardRoot: "/admin/dashboard",
        settings: "/admin/dashboard/settings",
        markets: "/admin/dashboard/markets",
        portfolios: "/admin/dashboard/markets/portfolios",
      },
    }),
    [],
  );
  return (
    <AdminProvider value={value}>
      <VoiceAssistant />
    </AdminProvider>
  );
}
