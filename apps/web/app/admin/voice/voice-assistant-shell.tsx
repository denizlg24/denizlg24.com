"use client";

import { type AdminContextValue, AdminProvider } from "@repo/admin/provider";
import { useMemo } from "react";
import { createWebAdminClient } from "@/lib/admin-client";
import { WEB_ADMIN_ROUTES } from "@/lib/admin-routes";
import { webPlatform } from "@/lib/platform-bridge";
import { VoiceAssistant } from "./voice-assistant";

export function VoiceAssistantShell() {
  const value = useMemo<AdminContextValue>(
    () => ({
      client: createWebAdminClient(),
      platform: webPlatform,
      routes: WEB_ADMIN_ROUTES,
    }),
    [],
  );
  return (
    <AdminProvider value={value}>
      <VoiceAssistant />
    </AdminProvider>
  );
}
