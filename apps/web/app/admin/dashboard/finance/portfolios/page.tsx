import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";
import { PortfoliosRoute } from "./portfolios-route";

export const metadata: Metadata = {
  title: "Portfolios | Admin Dashboard",
};

export default function Page() {
  return (
    <AdminFeatureShell>
      <Suspense fallback={null}>
        <PortfoliosRoute />
      </Suspense>
    </AdminFeatureShell>
  );
}
