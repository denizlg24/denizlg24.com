"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { AdminClient } from "./client";
import type { PlatformBridge } from "./platform";

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

/** Where the host mounts shared multi-page features. */
export interface AdminRoutes {
  /** Root path accepted by agent navigation tools. */
  dashboardRoot: string;
  /** Base path of the global settings pages, without a trailing slash. */
  settings: string;
  /** Full path of the markets dashboard, which finance links across to. */
  markets: string;
  /** Full path of the virtual-portfolios surface, paired with markets. */
  portfolios: string;
}

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
