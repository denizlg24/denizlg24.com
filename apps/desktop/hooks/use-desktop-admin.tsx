"use client";

import type { AdminContextValue } from "@repo/admin/provider";
import { useMemo } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useUserSettings } from "@/context/user-context";
import { createDesktopAdminClient } from "@/lib/admin-client";
import { desktopPlatform } from "@/lib/platform-bridge";

/**
 * Builds the AdminProvider value for a desktop admin route: a Bearer-auth client
 * from user settings, the Tauri platform bridge, and the mobile sidebar trigger
 * slot. `loading` reflects settings still loading (render the feature skeleton).
 */
export function useDesktopAdmin(): {
  value: AdminContextValue;
  loading: boolean;
} {
  const { settings, loading } = useUserSettings();

  const value = useMemo<AdminContextValue>(
    () => ({
      client: createDesktopAdminClient(settings.apiKey),
      platform: desktopPlatform,
      slots: {
        sidebarTrigger: <SidebarTrigger className="-ml-1 size-7 md:hidden" />,
      },
    }),
    [settings.apiKey],
  );

  return { value, loading };
}
