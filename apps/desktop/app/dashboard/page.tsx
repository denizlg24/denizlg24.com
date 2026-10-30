"use client";

import { WorkspacePageView } from "@repo/admin/workspace/page-view";
import { HOME_PAGE_ID } from "@repo/schemas";

export default function Home() {
  return <WorkspacePageView pageId={HOME_PAGE_ID} />;
}
