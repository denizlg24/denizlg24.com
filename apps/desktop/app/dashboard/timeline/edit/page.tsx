"use client";

import { TimelineEditorPage } from "@repo/admin/timeline/timeline-editor-page";
import { AdminRecordRoute } from "@/components/admin-route";

export default function EditTimelineRoute() {
  return (
    <AdminRecordRoute redirectTo="/dashboard/timeline">
      {(id) => <TimelineEditorPage mode="edit" itemId={id} />}
    </AdminRecordRoute>
  );
}
