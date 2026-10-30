import { WorkspacePageView } from "@repo/admin/workspace/page-view";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pageId = decodeURIComponent(id);
  return (
    <AdminFeatureShell>
      <WorkspacePageView key={pageId} pageId={pageId} />
    </AdminFeatureShell>
  );
}
