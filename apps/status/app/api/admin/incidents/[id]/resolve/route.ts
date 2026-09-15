import { audited, incidentDetail, settleIncident } from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";

export const POST = adminRoute<{ id: string }>(
  async ({ actor, params }) => {
    const incident = await audited(actor, "incident-resolve", params.id, () =>
      settleIncident(actor, params.id, "resolve"),
    );
    return { incident: incidentDetail(incident) };
  },
  { write: true },
);
