import { HoldingsPage } from "@repo/admin/brokerage/holdings-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Holdings | Admin Dashboard",
};

export default function HoldingsRoute() {
  return (
    <AdminFeatureShell>
      <HoldingsPage />
    </AdminFeatureShell>
  );
}
