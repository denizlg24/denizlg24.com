import { FinanceAlertsPage } from "@repo/admin/finance/finance-alerts-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Budget alerts | Admin Dashboard",
};

export default function AlertsRoute() {
  return (
    <AdminFeatureShell>
      <FinanceAlertsPage />
    </AdminFeatureShell>
  );
}
