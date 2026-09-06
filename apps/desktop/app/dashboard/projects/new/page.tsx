"use client";

import { ProjectEditorPage } from "@repo/admin/projects/project-editor-page";
import { AdminRoute } from "@/components/admin-route";

export default function NewProjectRoute() {
  return (
    <AdminRoute>
      <ProjectEditorPage mode="create" />
    </AdminRoute>
  );
}
