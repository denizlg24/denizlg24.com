"use client";

import { FinanceBudgetPage } from "@repo/admin/finance/finance-budget-page";
import { AdminRoute } from "@/components/admin-route";

export default function BudgetRoute() {
  return (
    <AdminRoute>
      <FinanceBudgetPage />
    </AdminRoute>
  );
}
