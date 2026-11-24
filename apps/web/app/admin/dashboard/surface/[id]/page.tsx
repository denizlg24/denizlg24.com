import { SurfaceRouteView } from "@repo/admin/workspace/surfaces/surface-route";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function SurfacePage() {
  return (
    <AdminFeatureShell>
      <SurfaceRouteView />
    </AdminFeatureShell>
  );
}
