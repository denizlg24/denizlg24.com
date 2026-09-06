"use client";

import { FinanceAlertsPage } from "@repo/admin/finance/finance-alerts-page";
import { AdminRoute } from "@/components/admin-route";

export default function AlertsRoute() {
  return (
    <AdminRoute>
      <FinanceAlertsPage />
    </AdminRoute>
  );
}
