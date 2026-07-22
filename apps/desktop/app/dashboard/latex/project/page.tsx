import { LatexWorkspaceSkeleton } from "@repo/admin/latex/latex-workspace-page";
import { Suspense } from "react";
import { LatexDesktopWorkspaceRoute } from "./latex-workspace-route";

export default function LatexWorkspacePage() {
  return (
    <Suspense fallback={<LatexWorkspaceSkeleton />}>
      <LatexDesktopWorkspaceRoute />
    </Suspense>
  );
}
