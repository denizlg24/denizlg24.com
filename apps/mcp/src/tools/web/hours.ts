import type { McpServer } from "@modelcontextprotocol/server";
import {
  workClockActionSchema,
  workJobInputSchema,
  workJobUpdateSchema,
  workSessionInputSchema,
  workSessionsQuerySchema,
  workSessionUpdateSchema,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p } from "../define";

const id = z.string().min(1).describe("Mongo _id");

export function registerWebHours(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_work_hours",
    title: "Web: work hours",
    description:
      "Hour tracker: clock in/out and breaks, shifts, jobs and the current pay period.",
    actions: {
      overview: action({
        description:
          "Jobs, the open shift, today/week/month totals, recent shifts and each payout's current pay period",
        readOnly: true,
        run: () => api.web.get("/api/admin/hours"),
      }),
      clock: action({
        description:
          "in, out, break or resume; `at` backdates, `jobId` picks the job for `in`",
        input: z.object({
          clock: workClockActionSchema.shape.action,
          jobId: workClockActionSchema.shape.jobId,
          at: workClockActionSchema.shape.at,
          note: workClockActionSchema.shape.note,
        }),
        run: ({ clock, ...body }) =>
          api.web.post("/api/admin/hours/clock", { action: clock, ...body }),
      }),
      sessions: action({
        description: "Shifts by job-local day range",
        input: workSessionsQuerySchema,
        readOnly: true,
        run: (query) => api.web.get("/api/admin/hours/sessions", query),
      }),
      session_create: action({
        description: "Adds a finished or open shift by hand",
        input: z.object({ session: workSessionInputSchema }),
        run: ({ session }) =>
          api.web.post("/api/admin/hours/sessions", session),
      }),
      session_update: action({
        description: "Changes a shift's times, breaks, job or note",
        input: z.object({ id, ...workSessionUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/hours/sessions/${id}`, body),
      }),
      session_delete: action({
        description: "Deletes a shift",
        input: z.object({ id }),
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/hours/sessions/${id}`),
      }),
      jobs: action({
        description: "Every job with its rate",
        readOnly: true,
        run: () => api.web.get("/api/admin/hours/jobs"),
      }),
      job_create: action({
        description: "Adds a job",
        input: z.object({ job: workJobInputSchema }),
        run: ({ job }) => api.web.post("/api/admin/hours/jobs", job),
      }),
      job_update: action({
        description: "Changes a job's rate, schedule or status",
        input: z.object({ id, ...workJobUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/hours/jobs/${id}`, body),
      }),
    },
  });
}
