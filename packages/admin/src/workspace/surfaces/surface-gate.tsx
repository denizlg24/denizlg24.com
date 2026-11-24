"use client";

import {
  HOME_PAGE_ID,
  type SurfaceChrome,
  type WorkspaceSurfaceSummary,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Fragment, type ReactNode, useEffect } from "react";
import { useAdmin } from "../../provider";
import { SidebarTrigger } from "../sidebar-trigger";
import { useActiveLocation, useWorkspaceNav } from "../use-workspace-nav";
import { useSurface, useSurfaceList, useSurfaceStore } from "./store";
import { SurfaceFrame } from "./surface-frame";

type Target = { id: string; chrome: SurfaceChrome | undefined };

/**
 * Query params that open one record on a module's own route (desktop's static
 * export addresses records this way). Those stay the default UI, so record
 * links and deniz.navigate to a detail work under a module mount.
 */
const RECORD_PARAMS = ["id", "portfolio", "ticker"];

function selectsRecord(params: Pick<URLSearchParams, "get">): boolean {
  return RECORD_PARAMS.some((name) => params.get(name) !== null);
}

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** ⌘⇧E / Ctrl⇧E flips the session bypass from anywhere outside a frame. */
function useBypassShortcut() {
  const setBypass = useSurfaceStore((s) => s.setBypass);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === "KeyE"
      ) {
        event.preventDefault();
        setBypass(!useSurfaceStore.getState().bypass);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setBypass]);
}

/**
 * Which surface replaces the default UI here: the surface route's own, else
 * the one mounted on Home or on this module's landing route — never its
 * sub-routes or a record opened on it. Settings is
 * never covered, so the surface editor stays reachable.
 *
 * Reads search params outside a Suspense boundary on purpose: a boundary here
 * would swap the page for a fallback whenever any page suspends. Neither shell
 * is prerendered (web's layout is dynamic, desktop's renders after settings
 * load), so the hook never bails out.
 */
function useSurfaceTarget(
  list: WorkspaceSurfaceSummary[] | null,
): Target | null {
  const { routes } = useAdmin();
  const { moduleForPath } = useWorkspaceNav();
  const { pathname, pageId } = useActiveLocation();
  const params = useSearchParams();

  if (!pathname) return null;
  const routeId = routes.surfaceAt(pathname, params);
  if (routeId) {
    const chrome = list?.find((s) => s.id === routeId)?.chrome;
    return { id: routeId, chrome };
  }
  if (!list || isUnder(pathname, routes.settings)) return null;

  let mounted: WorkspaceSurfaceSummary | undefined;
  if (pageId === HOME_PAGE_ID) {
    mounted = list.find((s) => s.mount.kind === "home");
  } else {
    const module = moduleForPath(pathname);
    if (module && module.href === pathname && !selectsRecord(params)) {
      mounted = list.find(
        (s) => s.mount.kind === "module" && s.mount.module === module.id,
      );
    }
  }
  return mounted ? { id: mounted.id, chrome: mounted.chrome } : null;
}

/**
 * Wraps the shell's sidebar and page area. Where a surface is mounted it
 * renders the surface instead of the page; `chrome: "none"` drops the sidebar
 * too. The exit control and ⌘⇧E live in the host document, so they work
 * however broken the surface is.
 */
export function SurfaceGate({
  sidebar,
  wrap,
  children,
}: {
  sidebar: ReactNode;
  /** Wraps the page area either way — desktop keeps its agent dock here. */
  wrap?: (content: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const list = useSurfaceList();
  const bypass = useSurfaceStore((s) => s.bypass);
  const setBypass = useSurfaceStore((s) => s.setBypass);
  useBypassShortcut();

  const target = useSurfaceTarget(list);
  const active = bypass ? null : target;
  const loaded = useSurface(active?.id ?? null);
  const shown = active && loaded !== "missing" ? active : null;
  const surface = loaded === "missing" ? null : loaded;
  const frame = (content: ReactNode) => (wrap ? wrap(content) : content);

  if (!shown) {
    return (
      <Fragment>
        {sidebar}
        {frame(children)}
      </Fragment>
    );
  }

  const chrome = surface?.chrome ?? shown.chrome;
  const exit = () => setBypass(true);

  return (
    <Fragment>
      {chrome === "none" ? null : sidebar}
      {frame(
        <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
          {surface ? (
            <SurfaceFrame
              key={surface.id}
              surface={surface}
              onExit={exit}
              className="min-h-0 flex-1"
            />
          ) : (
            <div className="min-h-0 flex-1 bg-background" />
          )}
          <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 opacity-25 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
            {chrome === "none" ? null : <SidebarTrigger className="ml-0" />}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Exit surface"
              title="⌘⇧E"
              onClick={exit}
              className="text-muted-foreground"
            >
              <X />
            </Button>
          </div>
        </div>,
      )}
    </Fragment>
  );
}
