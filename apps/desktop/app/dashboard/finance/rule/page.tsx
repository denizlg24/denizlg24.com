"use client";

import { FinanceRulePage } from "@repo/admin/finance/finance-rule-page";
import { AdminQueryRoute } from "@/components/admin-route";

export default function RuleRoute() {
  return (
    <AdminQueryRoute>
      {(params) => (
        <FinanceRulePage
          ruleId={params.get("id") ?? undefined}
          candidateFingerprint={params.get("candidate") ?? undefined}
        />
      )}
    </AdminQueryRoute>
  );
}
