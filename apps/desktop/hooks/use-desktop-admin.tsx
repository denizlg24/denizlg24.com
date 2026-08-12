"use client";

import type { AdminContextValue } from "@repo/admin/provider";
import { Laptop } from "lucide-react";
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
      routes: {
        dashboardRoot: "/dashboard",
        settings: "/dashboard/settings",
        markets: "/dashboard/markets",
        portfolios: "/dashboard/markets/portfolios",
      },
      slots: {
        sidebarTrigger: <SidebarTrigger className="-ml-1 size-7 md:hidden" />,
        // Device settings read the Tauri store and updater, so the route lives
        // in this app and only its rail entry is handed to the shared shell.
        settingsExtraSections: [
          {
            slug: "device",
            label: "Device",
            icon: <Laptop className="size-3.5" />,
          },
        ],
      },
    }),
    [settings.apiKey],
  );

  return { value, loading };
}
