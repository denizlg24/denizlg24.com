import { TimelinePage } from "@repo/admin/timeline/timeline-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Timeline | Admin Dashboard",
  description: "Manage timeline entries",
};

export default function TimelineRoute() {
  return (
    <AdminFeatureShell>
      <TimelinePage newHref="/admin/dashboard/timeline/new" />
    </AdminFeatureShell>
  );
}
