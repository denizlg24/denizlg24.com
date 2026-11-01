"use client";

import { HOME_PAGE_ID } from "@repo/schemas";
import { usePathname, useSearchParams } from "next/navigation";
import { useAdmin } from "../provider";
import { type CustomizedNav, customizeNav } from "./appearance/customize-nav";
import { useAppearanceStore } from "./appearance/store";
import { workspaceNav } from "./refs";

/** The host's modules and pages, dressed with the owner's module labels, icons and order. */
export function useWorkspaceNav(): CustomizedNav {
  const base = workspaceNav(useAdmin().routes);
  const modules = useAppearanceStore((s) => s.appearance.modules);
  const moduleOrder = useAppearanceStore((s) => s.appearance.moduleOrder);
  const sectionOrder = useAppearanceStore((s) => s.appearance.sectionOrder);
  return customizeNav(base, { modules, moduleOrder, sectionOrder });
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
