"use client";

import { EmptyState } from "@repo/ui/empty-state";
import { LayoutTemplate } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAdmin } from "../../provider";
import { useSurface } from "./store";
import { SurfaceFrame } from "./surface-frame";

/**
 * The surface route's page. The gate normally covers it with the surface on
 * its own chrome; this renders only under the bypass, inside the default shell.
 */
export function SurfaceRouteView() {
  const { routes } = useAdmin();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = pathname ? routes.surfaceAt(pathname, params) : null;
  const surface = useSurface(id);

  if (!id || surface === "missing") {
    return <EmptyState icon={<LayoutTemplate />} label="No surface" />;
  }
  if (!surface) return <div className="h-full w-full bg-background" />;
  return <SurfaceFrame key={surface.id} surface={surface} />;
}
