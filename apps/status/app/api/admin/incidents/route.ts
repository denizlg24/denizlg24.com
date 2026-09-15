import {
  statusIncidentCreateInputSchema,
  statusIncidentListQuerySchema,
} from "@repo/schemas/status";
import {
  audited,
  createIncident,
  incidentDetail,
  listIncidents,
} from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";

export const GET = adminRoute(({ query }) =>
  listIncidents(
    statusIncidentListQuerySchema.parse(Object.fromEntries(query.entries())),
  ),
);

export const POST = adminRoute(
  async ({ actor, body }) => {
    const input = statusIncidentCreateInputSchema.parse(await body());
    const incident = await audited(actor, "incident-create", input.title, () =>
      createIncident(actor, input),
    );
    return { incident: incidentDetail(incident) };
  },
  { write: true, status: 201 },
);
