"use client";

import { FinanceReviewsPage } from "@repo/admin/finance/finance-reviews-page";
import { AdminRoute } from "@/components/admin-route";

export default function ReviewsRoute() {
  return (
    <AdminRoute>
      <FinanceReviewsPage />
    </AdminRoute>
  );
}
