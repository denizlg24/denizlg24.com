"use client";

import {
  HoldingsPage,
  HoldingsSkeleton,
} from "@repo/admin/brokerage/holdings-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function HoldingsRoute() {
  const { value, loading } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      {loading ? <HoldingsSkeleton /> : <HoldingsPage />}
    </AdminProvider>
  );
}
