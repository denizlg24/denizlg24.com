"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { AdminClient } from "./client";
import type { PlatformBridge } from "./platform";
import type { AdminRoutes } from "./routes";

/** A settings rail entry the host app owns and routes to itself. */
export interface SettingsRailEntry {
  slug: string;
  label: string;
  icon: ReactNode;
}

/** App-specific shell fragments injected into shared feature headers. */
export interface AdminSlots {
  /** Desktop passes its `<SidebarTrigger>`; web passes nothing. */
  sidebarTrigger?: ReactNode;
  /**
   * Extra settings sections the host renders on its own routes — desktop's
   * device/update settings depend on Tauri APIs the shared package can't import.
   */
  settingsExtraSections?: SettingsRailEntry[];
}

export type { AdminRoutes } from "./routes";

export interface AdminContextValue {
  client: AdminClient;
  platform: PlatformBridge;
  routes: AdminRoutes;
  slots?: AdminSlots;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({
  value,
  children,
}: {
  value: AdminContextValue;
  children: ReactNode;
}) {
  return (
    <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
  );
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) {
    throw new Error("useAdmin must be used within an AdminProvider");
  }
  return ctx;
}
