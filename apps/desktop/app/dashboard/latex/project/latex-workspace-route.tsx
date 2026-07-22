"use client";

import {
  LatexWorkspacePage,
  LatexWorkspaceSkeleton,
} from "@repo/admin/latex/latex-workspace-page";
import { AdminProvider } from "@repo/admin/provider";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export function LatexDesktopWorkspaceRoute() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("id");
  const [projectId, setProjectId] = useState<string | null>(null);
  const { value, loading } = useDesktopAdmin();

  useEffect(() => {
    setProjectId(queryProjectId);
    if (!queryProjectId) router.replace("/dashboard/latex");
  }, [queryProjectId, router]);

  return (
    <AdminProvider value={value}>
      {loading || !projectId ? (
        <LatexWorkspaceSkeleton />
      ) : (
        <LatexWorkspacePage projectId={projectId} listHref="/dashboard/latex" />
      )}
    </AdminProvider>
  );
}
