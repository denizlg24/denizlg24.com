"use client";

import { FinanceEnvelopePage } from "@repo/admin/finance/finance-envelope-page";
import { AdminQueryRoute } from "@/components/admin-route";

export default function EnvelopeRoute() {
  return (
    <AdminQueryRoute>
      {(params) => {
        const limit = Number(params.get("limit"));
        return (
          <FinanceEnvelopePage
            envelopeId={params.get("id") ?? undefined}
            seedCategory={params.get("category") ?? undefined}
            seedLimitMinor={Number.isFinite(limit) ? limit : undefined}
          />
        );
      }}
    </AdminQueryRoute>
  );
}
