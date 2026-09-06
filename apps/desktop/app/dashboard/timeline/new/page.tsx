"use client";

import { TimelineEditorPage } from "@repo/admin/timeline/timeline-editor-page";
import { AdminRoute } from "@/components/admin-route";

export default function NewTimelineRoute() {
  return (
    <AdminRoute>
      <TimelineEditorPage mode="create" />
    </AdminRoute>
  );
}
