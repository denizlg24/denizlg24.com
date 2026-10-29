"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { WorkspacePageView } from "@/components/workspace/page-view";
import { HOME_PAGE_ID } from "@/lib/workspace/schema";

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
