import { statusIncidentEscalateInputSchema } from "@repo/schemas/status";
import { audited, escalateIncident, incidentDetail } from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";
import { AccessError } from "@/lib/auth";
import { githubConfig } from "@/lib/github";

export const POST = adminRoute<{ id: string }>(
  async ({ actor, params, body }) => {
    if (!githubConfig())
      throw new AccessError(
        503,
        "Escalation is not configured (STATUS_GITHUB_TOKEN).",
      );
    const input = statusIncidentEscalateInputSchema.parse(await body());
    const result = await audited(actor, "incident-escalate", params.id, () =>
      escalateIncident(actor, params.id, input),
    );
    return {
      incident: incidentDetail(result.incident),
      issueUrl: result.issueUrl,
      created: result.created,
    };
  },
  { write: true },
);
