import { FinancePage } from "@repo/admin/finance/finance-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Finance | Admin Dashboard",
};

export default function FinanceRoute() {
  return (
    <AdminFeatureShell>
      <FinancePage manageAccounts />
    </AdminFeatureShell>
  );
}
