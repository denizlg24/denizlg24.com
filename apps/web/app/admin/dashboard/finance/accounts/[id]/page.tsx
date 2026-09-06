import { FinanceAccountsPage } from "@repo/admin/finance/finance-accounts-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Account | Admin Dashboard",
};

export default async function AccountsDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <FinanceAccountsPage accountId={id} />
    </AdminFeatureShell>
  );
}
