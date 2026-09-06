import { FinanceRulePage } from "@repo/admin/finance/finance-rule-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Rule | Admin Dashboard",
};

export default async function RuleDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <FinanceRulePage ruleId={id} />
    </AdminFeatureShell>
  );
}
