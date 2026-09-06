import { FinanceEntryPage } from "@repo/admin/finance/finance-entry-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Entry | Admin Dashboard",
};

export default async function EntryDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <FinanceEntryPage entryId={id} />
    </AdminFeatureShell>
  );
}
