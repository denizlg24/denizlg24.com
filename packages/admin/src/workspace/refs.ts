import {
  HOME_PAGE_ID,
  parseRef,
  type WorkspacePage,
  type WorkspaceRef,
} from "@repo/schemas";
import type { AdminRoutes } from "../routes";
import {
  type ModuleDef,
  type ModuleId,
  moduleForPath,
  resolveModules,
} from "./modules";

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

/** The workspace's paths in one host: pages, and the modules it has. */
export type WorkspaceNav = {
  routes: AdminRoutes;
  modules: ModuleDef[];
  /** Every module that is a destination rather than a shortcut. */
  sidebarModules: ModuleDef[];
  pageHref: (id: string) => string;
  moduleHref: (id: ModuleId) => string | undefined;
  getModule: (id: string) => ModuleDef | undefined;
  moduleForPath: (pathname: string) => ModuleDef | undefined;
  /** A ref with what it points at, or null when the page is gone or trashed. */
  resolveRef: (
    ref: WorkspaceRef,
    pages: Record<string, WorkspacePage>,
  ) => ResolvedRef | null;
};

const navCache = new WeakMap<AdminRoutes, WorkspaceNav>();

export function workspaceNav(routes: AdminRoutes): WorkspaceNav {
  const cached = navCache.get(routes);
  if (cached) return cached;

  const modules = resolveModules(routes.workspace.modules);
  const byId = new Map<string, ModuleDef>(modules.map((m) => [m.id, m]));
  const pageHref = (id: string) =>
    id === HOME_PAGE_ID ? routes.dashboardRoot : routes.workspace.page(id);

  const nav: WorkspaceNav = {
    routes,
    modules,
    sidebarModules: modules.filter((m) => !m.shortcut),
    pageHref,
    moduleHref: (id) => byId.get(id)?.href,
    getModule: (id) => byId.get(id),
    moduleForPath: (pathname) => moduleForPath(modules, pathname),
    resolveRef: (ref, pages) => {
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
      const module = byId.get(parsed.id);
      if (!module) return null;
      return {
        kind: "module",
        ref,
        module,
        href: module.href,
        label: module.label,
      };
    },
  };
  navCache.set(routes, nav);
  return nav;
}
