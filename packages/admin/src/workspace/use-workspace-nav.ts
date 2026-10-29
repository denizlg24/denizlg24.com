"use client";

import { HOME_PAGE_ID } from "@repo/schemas";
import { usePathname, useSearchParams } from "next/navigation";
import { useAdmin } from "../provider";
import { type WorkspaceNav, workspaceNav } from "./refs";

export function useWorkspaceNav(): WorkspaceNav {
  return workspaceNav(useAdmin().routes);
}

/** Where the app is: a workspace page id, or a module path. */
export function useActiveLocation() {
  const { routes } = useWorkspaceNav();
  const pathname = usePathname();
  const params = useSearchParams();
  const pageId =
    pathname === routes.dashboardRoot
      ? HOME_PAGE_ID
      : routes.workspace.pageAt(pathname, params);
  return { pathname, pageId };
}
