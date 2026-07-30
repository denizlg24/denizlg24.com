"use client";

import { FinancePage, FinanceSkeleton } from "@repo/admin/finance/finance-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function FinanceRoute() {
  const { value, loading } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      {loading ? <FinanceSkeleton /> : <FinancePage manageAccounts />}
    </AdminProvider>
  );
}
