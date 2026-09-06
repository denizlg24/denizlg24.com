"use client";

import { FinanceEntryPage } from "@repo/admin/finance/finance-entry-page";
import { AdminQueryRoute } from "@/components/admin-route";

export default function EntryRoute() {
  return (
    <AdminQueryRoute>
      {(params) => <FinanceEntryPage entryId={params.get("id") ?? undefined} />}
    </AdminQueryRoute>
  );
}
