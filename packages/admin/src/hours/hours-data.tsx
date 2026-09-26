import {
  type WorkClockAction,
  type WorkJobInputPayload,
  type WorkJobUpdatePayload,
  type WorkSessionUpdate,
  workHoursOverviewSchema,
  workJobSchema,
  workSessionSchema,
} from "@repo/schemas";
import { z } from "zod";
import type { AdminClient, AdminRequestOptions } from "../client";

const sessionResponseSchema = z.object({ session: workSessionSchema });
const sessionsResponseSchema = z.object({
  sessions: z.array(workSessionSchema),
});
const jobResponseSchema = z.object({ job: workJobSchema });

export async function fetchWorkHours(
  client: AdminClient,
  options?: AdminRequestOptions,
) {
  return workHoursOverviewSchema.parse(
    await client.get<unknown>("hours", options),
  );
}

export async function clockWork(client: AdminClient, input: WorkClockAction) {
  const response = await client.post<unknown>("hours/clock", input);
  return sessionResponseSchema.parse(response).session;
}

export async function fetchWorkSessions(
  client: AdminClient,
  query: { from?: string; to?: string; jobId?: string },
  options?: AdminRequestOptions,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) search.set(key, value);
  }
  const response = await client.get<unknown>(
    `hours/sessions${search.size ? `?${search}` : ""}`,
    options,
  );
  return sessionsResponseSchema.parse(response).sessions;
}

export async function createWorkSession(
  client: AdminClient,
  input: {
    jobId: string;
    start: string;
    end?: string;
    breaks: { start: string; end?: string }[];
    note?: string;
  },
) {
  const response = await client.post<unknown>("hours/sessions", input);
  return sessionResponseSchema.parse(response).session;
}

export async function updateWorkSession(
  client: AdminClient,
  id: string,
  input: WorkSessionUpdate,
) {
  const response = await client.patch<unknown>(
    `hours/sessions/${encodeURIComponent(id)}`,
    input,
  );
  return sessionResponseSchema.parse(response).session;
}

export async function deleteWorkSession(client: AdminClient, id: string) {
  await client.del<unknown>(`hours/sessions/${encodeURIComponent(id)}`);
}

export async function createWorkJob(
  client: AdminClient,
  input: WorkJobInputPayload,
) {
  const response = await client.post<unknown>("hours/jobs", input);
  return jobResponseSchema.parse(response).job;
}

export async function updateWorkJob(
  client: AdminClient,
  id: string,
  input: WorkJobUpdatePayload,
) {
  const response = await client.patch<unknown>(
    `hours/jobs/${encodeURIComponent(id)}`,
    input,
  );
  return jobResponseSchema.parse(response).job;
}

export async function fetchWorkJobs(client: AdminClient) {
  const response = await client.get<unknown>("hours/jobs");
  return z.object({ jobs: z.array(workJobSchema) }).parse(response).jobs;
}
