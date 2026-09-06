import { FinanceBudgetPage } from "@repo/admin/finance/finance-budget-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Budget | Admin Dashboard",
};

export default function BudgetRoute() {
  return (
    <AdminFeatureShell>
      <FinanceBudgetPage />
    </AdminFeatureShell>
  );
}
