import { FinanceRulePage } from "@repo/admin/finance/finance-rule-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "New rule | Admin Dashboard",
};

export default async function RuleNewRoute({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const candidate = Array.isArray(params.candidate)
    ? params.candidate[0]
    : params.candidate;
  return (
    <AdminFeatureShell>
      <FinanceRulePage candidateFingerprint={candidate} />
    </AdminFeatureShell>
  );
}
