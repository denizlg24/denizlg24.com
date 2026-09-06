import { FinanceReviewsPage } from "@repo/admin/finance/finance-reviews-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Match review | Admin Dashboard",
};

export default function ReviewsRoute() {
  return (
    <AdminFeatureShell>
      <FinanceReviewsPage />
    </AdminFeatureShell>
  );
}
