import { getIncident } from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";

export const GET = adminRoute<{ id: string }>(({ params }) =>
  getIncident(params.id),
);
