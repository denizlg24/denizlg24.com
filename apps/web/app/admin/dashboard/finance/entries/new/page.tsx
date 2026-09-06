import { FinanceEntryPage } from "@repo/admin/finance/finance-entry-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "New entry | Admin Dashboard",
};

export default function EntryRoute() {
  return (
    <AdminFeatureShell>
      <FinanceEntryPage />
    </AdminFeatureShell>
  );
}
