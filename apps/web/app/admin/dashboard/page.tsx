import { WorkspacePageView } from "@repo/admin/workspace/page-view";
import { HOME_PAGE_ID } from "@repo/schemas";
import { AdminFeatureShell } from "./_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <WorkspacePageView pageId={HOME_PAGE_ID} />
    </AdminFeatureShell>
  );
}
