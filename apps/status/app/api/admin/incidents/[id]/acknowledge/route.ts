import { audited, incidentDetail, settleIncident } from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";

export const POST = adminRoute<{ id: string }>(
  async ({ actor, params }) => {
    const incident = await audited(
      actor,
      "incident-acknowledge",
      params.id,
      () => settleIncident(actor, params.id, "acknowledge"),
    );
    return { incident: incidentDetail(incident) };
  },
  { write: true },
);
