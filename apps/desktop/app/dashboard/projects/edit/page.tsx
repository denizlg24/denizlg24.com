"use client";

import { ProjectEditorPage } from "@repo/admin/projects/project-editor-page";
import { AdminRecordRoute } from "@/components/admin-route";

export default function EditProjectRoute() {
  return (
    <AdminRecordRoute redirectTo="/dashboard/projects">
      {(id) => <ProjectEditorPage mode="edit" projectId={id} />}
    </AdminRecordRoute>
  );
}
