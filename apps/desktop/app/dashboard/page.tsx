"use client";

import { WorkspacePageView } from "@/components/workspace/page-view";
import { HOME_PAGE_ID } from "@/lib/workspace/schema";

export default function Home() {
  return <WorkspacePageView pageId={HOME_PAGE_ID} />;
}
