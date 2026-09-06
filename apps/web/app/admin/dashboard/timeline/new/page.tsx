import { TimelineEditorPage } from "@repo/admin/timeline/timeline-editor-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "New Entry | Admin Dashboard",
};

export default function NewTimelineRoute() {
  return (
    <AdminFeatureShell>
      <TimelineEditorPage mode="create" />
    </AdminFeatureShell>
  );
}
