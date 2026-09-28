import { HoursApp } from "@repo/admin/hours/hours-app";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Hours | Admin Dashboard",
};

export default function HoursRoute() {
  return (
    <AdminFeatureShell>
      <HoursApp />
    </AdminFeatureShell>
  );
}
