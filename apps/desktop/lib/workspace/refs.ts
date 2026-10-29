import { DASHBOARD_PREFIX, getModule, type ModuleDef } from "./modules";
import {
  HOME_PAGE_ID,
  parseRef,
  type WorkspacePage,
  type WorkspaceRef,
} from "./schema";

export const PAGE_ROUTE = `${DASHBOARD_PREFIX}/page`;

export function pageHref(id: string): string {
  return id === HOME_PAGE_ID
    ? DASHBOARD_PREFIX
    : `${PAGE_ROUTE}?id=${encodeURIComponent(id)}`;
}

export function pageTitle(page: Pick<WorkspacePage, "title">): string {
  return page.title.trim() || "Untitled";
}

export type ResolvedRef =
  | {
      kind: "page";
      ref: WorkspaceRef;
      page: WorkspacePage;
      href: string;
      label: string;
    }
  | {
      kind: "module";
      ref: WorkspaceRef;
      module: ModuleDef;
      href: string;
      label: string;
    };

/** A ref with what it points at, or null when the page is gone or trashed. */
export function resolveRef(
  ref: WorkspaceRef,
  pages: Record<string, WorkspacePage>,
): ResolvedRef | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  if (parsed.kind === "page") {
    const page = pages[parsed.id];
    if (!page || page.deletedAt) return null;
    return {
      kind: "page",
      ref,
      page,
      href: pageHref(page.id),
      label: pageTitle(page),
    };
  }
  const module = getModule(parsed.id);
  if (!module) return null;
  return {
    kind: "module",
    ref,
    module,
    href: module.href,
    label: module.label,
  };
}
