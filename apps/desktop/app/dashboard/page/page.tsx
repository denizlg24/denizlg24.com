"use client";

import { WorkspacePageView } from "@repo/admin/workspace/page-view";
import { HOME_PAGE_ID } from "@repo/schemas";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function PageById() {
  const id = useSearchParams().get("id") ?? HOME_PAGE_ID;
  return <WorkspacePageView key={id} pageId={id} />;
}

export default function WorkspacePage() {
  return (
    <Suspense>
      <PageById />
    </Suspense>
  );
}
