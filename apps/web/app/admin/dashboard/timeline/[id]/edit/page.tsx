import { TimelineEditorPage } from "@repo/admin/timeline/timeline-editor-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Edit Entry | Admin Dashboard",
};

export default async function EditTimelineRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <TimelineEditorPage mode="edit" itemId={id} />
    </AdminFeatureShell>
  );
}
