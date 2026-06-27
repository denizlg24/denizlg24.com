"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { AdminClient } from "./client";
import type { PlatformBridge } from "./platform";

/** App-specific shell fragments injected into shared feature headers. */
export interface AdminSlots {
  /** Desktop passes its `<SidebarTrigger>`; web passes nothing. */
  sidebarTrigger?: ReactNode;
}

export interface AdminContextValue {
  client: AdminClient;
  platform: PlatformBridge;
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
