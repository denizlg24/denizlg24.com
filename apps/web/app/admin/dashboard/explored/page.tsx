import { ExploredMap } from "@repo/admin/location/explored-map";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Explored | Admin Dashboard",
};

export default function ExploredRoute() {
  return (
    <AdminFeatureShell>
      <ExploredMap />
    </AdminFeatureShell>
  );
}
