import type { McpServer } from "@modelcontextprotocol/server";
import {
  statusIncidentCreateInputSchema,
  statusIncidentEscalateInputSchema,
  statusIncidentListQuerySchema,
  statusIncidentUpdateInputSchema,
  statusMaintenanceInputSchema,
  statusSamplesQuerySchema,
} from "@repo/schemas/status";
import { z } from "zod";
import { type Api, action, defineActions, defineTool, p } from "../define";

const id = z.string().min(1).describe("Incident id, e.g. auto:… or manual:…");
const byId = z.object({ id });
const maintenanceId = z.string().min(1).describe("Maintenance window id");

/**
 * The status page (status.denizlg24.com): confirmed service health, the
 * incidents derived from it, maintenance windows and backup state. Routes are
 * `/api/admin/*` on the status app, verified with a token for its own
 * resource.
 */
export function registerStatus(server: McpServer, api: Api) {
  defineTool(server, {
    name: "status_overview",
    title: "Status: overview",
    description:
      "Every service with its confirmed status, the raw observed status, when it last changed, latency and the failing evidence lines; collector warnings; open incidents; active maintenance windows. Read this first.",
    input: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: () => api.status.get("/api/admin/overview"),
  });

  defineActions(server, {
    name: "status_incidents",
    title: "Status: incidents",
    description:
      "Incidents on the public status page. Automatic ones (auto:…) open after three consecutive failed observations and resolve five minutes after every service recovers; manual ones are the owner's. Updates are public or private; state follows investigating → identified → monitoring → resolved.",
    actions: {
      list: action({
        description: "Open incidents by default; state=all for history",
        readOnly: true,
        input: z.object({
          state: statusIncidentListQuerySchema.shape.state.optional(),
          limit: z.number().int().min(1).max(200).optional(),
        }),
        run: (query) => api.status.get("/api/admin/incidents", query),
      }),
      get: action({
        description:
          "One incident with its evidence, every update (both visibilities), agent verdict and issue link",
        readOnly: true,
        input: byId,
        run: ({ id }) => api.status.get(p`/api/admin/incidents/${id}`),
      }),
      create: action({
        description:
          "Opens a manual incident with a public investigating update; serviceIds must be on the page",
        input: statusIncidentCreateInputSchema,
        run: (body) => api.status.post("/api/admin/incidents", body),
      }),
      update: action({
        description:
          "Posts an update. visibility private keeps it off the public page; verdict records the triage conclusion (transient, operational or code)",
        input: z.object({ id, ...statusIncidentUpdateInputSchema.shape }),
        run: ({ id, ...body }) =>
          api.status.post(p`/api/admin/incidents/${id}/updates`, body),
      }),
      acknowledge: action({
        description:
          "Marks the incident acknowledged (and upstream, if linked)",
        input: byId,
        idempotent: true,
        run: ({ id }) =>
          api.status.post(p`/api/admin/incidents/${id}/acknowledge`),
      }),
      resolve: action({
        description:
          "Resolves the incident now. Automatic incidents resolve on their own once stable; use this only when the outage is over and monitoring cannot see it",
        input: byId,
        idempotent: true,
        run: ({ id }) => api.status.post(p`/api/admin/incidents/${id}/resolve`),
      }),
      escalate: action({
        description:
          "Opens a repository issue for a defect in the code (labels incident, agent-fix) with your diagnosis as the body; one per incident, a second call returns the first issue",
        input: z.object({ id, ...statusIncidentEscalateInputSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.status.post(p`/api/admin/incidents/${id}/escalate`, body),
      }),
    },
  });

  defineActions(server, {
    name: "status_maintenance",
    title: "Status: maintenance windows",
    description:
      "Planned maintenance. Services in an active window show as under maintenance and cannot open an automatic incident. repeat: weekly recurs at the same weekday and time.",
    actions: {
      list: action({
        description: "Windows that are recurring or ended within 30 days",
        readOnly: true,
        run: () => api.status.get("/api/admin/maintenance"),
      }),
      create: action({
        description: "Schedules a window (UTC ISO timestamps)",
        input: statusMaintenanceInputSchema,
        run: (body) => api.status.post("/api/admin/maintenance", body),
      }),
      update: action({
        description: "Replaces a window's fields",
        input: z.object({
          id: maintenanceId,
          ...statusMaintenanceInputSchema.shape,
        }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.status.patch(p`/api/admin/maintenance/${id}`, body),
      }),
      cancel: action({
        description: "Cancels a window",
        input: z.object({ id: maintenanceId }),
        idempotent: true,
        run: ({ id }) =>
          api.status.post(p`/api/admin/maintenance/${id}/cancel`),
      }),
    },
  });

  defineTool(server, {
    name: "status_service_samples",
    title: "Status: service samples",
    description:
      "Minute-by-minute confirmed and observed status of one service with the failing evidence per minute — what to read when diagnosing an incident.",
    input: z.object({
      serviceId: z.string().min(1).describe("Service id from status_overview"),
      minutes: statusSamplesQuerySchema.shape.minutes.optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: ({ serviceId, minutes }) =>
      api.status.get(p`/api/admin/services/${serviceId}/samples`, { minutes }),
  });

  defineTool(server, {
    name: "status_backups_list",
    title: "Status: backups",
    description:
      "Cloud backup tasks and disaster-recovery jobs as the status page sees them: last run, last success, next run, health.",
    input: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: () => api.status.get("/api/admin/backups"),
  });
}
