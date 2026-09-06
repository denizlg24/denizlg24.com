import { FinanceEnvelopePage } from "@repo/admin/finance/finance-envelope-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "New envelope | Admin Dashboard",
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EnvelopeNewRoute({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const limit = Number(one(params.limit));
  return (
    <AdminFeatureShell>
      <FinanceEnvelopePage
        seedCategory={one(params.category)}
        seedLimitMinor={Number.isFinite(limit) ? limit : undefined}
      />
    </AdminFeatureShell>
  );
}
