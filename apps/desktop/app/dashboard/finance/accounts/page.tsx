"use client";

import { FinanceAccountsPage } from "@repo/admin/finance/finance-accounts-page";
import { AdminQueryRoute } from "@/components/admin-route";

export default function AccountsRoute() {
  return (
    <AdminQueryRoute>
      {(params) => (
        <FinanceAccountsPage accountId={params.get("id") ?? undefined} />
      )}
    </AdminQueryRoute>
  );
}
