import { FinanceAccountsPage } from "@repo/admin/finance/finance-accounts-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Accounts | Admin Dashboard",
};

export default function AccountsRoute() {
  return (
    <AdminFeatureShell>
      <FinanceAccountsPage />
    </AdminFeatureShell>
  );
}
