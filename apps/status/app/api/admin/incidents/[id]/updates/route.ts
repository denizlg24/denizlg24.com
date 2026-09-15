import { statusIncidentUpdateInputSchema } from "@repo/schemas/status";
import { audited, incidentDetail, postIncidentUpdate } from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";

export const POST = adminRoute<{ id: string }>(
  async ({ actor, params, body }) => {
    const input = statusIncidentUpdateInputSchema.parse(await body());
    const incident = await audited(actor, "incident-update", params.id, () =>
      postIncidentUpdate(actor, params.id, input),
    );
    return { incident: incidentDetail(incident) };
  },
  { write: true },
);
