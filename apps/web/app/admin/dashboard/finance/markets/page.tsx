import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";
import { MarketsRoute } from "./markets-route";

export const metadata: Metadata = {
  title: "Markets | Admin Dashboard",
};

export default function Page() {
  return (
    <AdminFeatureShell>
      <Suspense fallback={null}>
        <MarketsRoute />
      </Suspense>
    </AdminFeatureShell>
  );
}
