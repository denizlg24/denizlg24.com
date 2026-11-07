import type { McpServer } from "@modelcontextprotocol/server";
import {
  createSprintSchema,
  createSprintSlotSchema,
  updateSprintSchema,
  updateSprintSlotSchema,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p } from "../define";

const sprintId = z.string().min(1).describe("Sprint id");
const slotId = z.string().min(1).describe("Slot id");
const runId = z.string().min(1).describe("Coding run id");
const bySprint = z.object({ sprintId });
const bySlot = z.object({ sprintId, slotId });

/**
 * No merge action on purpose: a release is offered, and taking the offer is
 * the owner's, from his own session.
 */
export function registerWebSprints(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_sprints",
    title: "Web: sprints",
    description:
      "Scheduled coding-agent sprints on a repository: slots (implement, review, fix-review, release, custom) chained by dependsOn, and the coding runs they produce.",
    actions: {
      list: action({
        description: "Sprints with status, repo, next slot and PR",
        readOnly: true,
        run: () => api.web.get("/api/admin/sprints"),
      }),
      get: action({
        description: "One sprint with every slot and run summary",
        input: bySprint,
        readOnly: true,
        run: ({ sprintId }) => api.web.get(p`/api/admin/sprints/${sprintId}`),
      }),
      slots: action({
        description: "Slots of every sprint in a time range (calendar view)",
        input: z.object({
          from: z.iso.datetime({ offset: true }),
          to: z.iso.datetime({ offset: true }),
        }),
        readOnly: true,
        run: (query) => api.web.get("/api/admin/sprints/slots", query),
      }),
      run_get: action({
        description:
          "One coding run with its transcript, result and CI; a live one answers with what it has so far",
        input: z.object({ runId }),
        readOnly: true,
        run: ({ runId }) => api.web.get(p`/api/admin/sprints/runs/${runId}`),
      }),
      create: action({
        description:
          "Creates a draft sprint; nothing fires until activate. Branch is generated when omitted",
        input: createSprintSchema,
        run: (body) => api.web.post("/api/admin/sprints", body),
      }),
      update: action({
        description:
          "Changes sprint fields; repo and branch are fixed once a run has pushed",
        input: z.object({ sprintId, ...updateSprintSchema.shape }),
        idempotent: true,
        run: ({ sprintId, ...body }) =>
          api.web.patch(p`/api/admin/sprints/${sprintId}`, body),
      }),
      slot_create: action({
        description:
          "Adds a slot; dependsOn defaults to the slot before it in time",
        input: z.object({ sprintId, ...createSprintSlotSchema.shape }),
        run: ({ sprintId, ...body }) =>
          api.web.post(p`/api/admin/sprints/${sprintId}/slots`, body),
      }),
      slot_update: action({
        description: "Changes a slot that is not queued or running",
        input: z.object({ sprintId, slotId, ...updateSprintSlotSchema.shape }),
        idempotent: true,
        run: ({ sprintId, slotId, ...body }) =>
          api.web.patch(
            p`/api/admin/sprints/${sprintId}/slots/${slotId}`,
            body,
          ),
      }),
      slot_delete: action({
        description: "Deletes a slot and removes it from every dependsOn",
        input: bySlot,
        destructive: true,
        run: ({ sprintId, slotId }) =>
          api.web.delete(p`/api/admin/sprints/${sprintId}/slots/${slotId}`),
      }),
      activate: action({
        description: "Makes a draft sprint's slots eligible to fire",
        input: bySprint,
        run: ({ sprintId }) =>
          api.web.post(p`/api/admin/sprints/${sprintId}/activate`),
      }),
      cancel: action({
        description:
          "Cancels the sprint: pending slots cancelled, live runs stopped",
        input: bySprint,
        destructive: true,
        run: ({ sprintId }) =>
          api.web.post(p`/api/admin/sprints/${sprintId}/cancel`),
      }),
      run_now: action({
        description: "Moves a scheduled slot's time to now",
        input: bySlot,
        run: ({ sprintId, slotId }) =>
          api.web.post(
            p`/api/admin/sprints/${sprintId}/slots/${slotId}/run-now`,
          ),
      }),
      retry: action({
        description: "Schedules a failed, skipped or cancelled slot again now",
        input: bySlot,
        run: ({ sprintId, slotId }) =>
          api.web.post(p`/api/admin/sprints/${sprintId}/slots/${slotId}/retry`),
      }),
      cancel_run: action({
        description: "Stops a live coding run",
        input: z.object({ runId }),
        destructive: true,
        run: ({ runId }) =>
          api.web.post(p`/api/admin/sprints/runs/${runId}/cancel`),
      }),
    },
  });
}
