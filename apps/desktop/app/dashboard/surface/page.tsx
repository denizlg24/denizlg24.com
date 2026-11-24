"use client";

import { SurfaceRouteView } from "@repo/admin/workspace/surfaces/surface-route";
import { Suspense } from "react";

export default function SurfacePage() {
  return (
    <Suspense>
      <SurfaceRouteView />
    </Suspense>
  );
}
