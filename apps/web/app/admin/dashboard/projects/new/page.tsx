import { ProjectEditorPage } from "@repo/admin/projects/project-editor-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "New Project | Admin Dashboard",
};

export default function NewProjectRoute() {
  return (
    <AdminFeatureShell>
      <ProjectEditorPage mode="create" />
    </AdminFeatureShell>
  );
}
