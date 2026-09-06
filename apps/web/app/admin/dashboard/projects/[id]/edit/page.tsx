import { ProjectEditorPage } from "@repo/admin/projects/project-editor-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Edit Project | Admin Dashboard",
};

export default async function EditProjectRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <ProjectEditorPage mode="edit" projectId={id} />
    </AdminFeatureShell>
  );
}
