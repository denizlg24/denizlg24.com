import { FinanceEnvelopePage } from "@repo/admin/finance/finance-envelope-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Envelope | Admin Dashboard",
};

export default async function EnvelopeDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <FinanceEnvelopePage envelopeId={id} />
    </AdminFeatureShell>
  );
}
