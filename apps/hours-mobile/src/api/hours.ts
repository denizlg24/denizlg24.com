import {
  financePayoutScheduleResponseSchema,
  type WorkClockAction,
  type WorkJobInputPayload,
  type WorkJobUpdatePayload,
  type WorkSessionUpdate,
  workHoursOverviewSchema,
  type workSessionInputSchema,
  workSessionSchema,
} from "@repo/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z as zod } from "zod";
import { api } from "@/lib/api";

const sessionsResponseSchema = zod.object({
  sessions: zod.array(workSessionSchema),
});

type SessionCreate = zod.input<typeof workSessionInputSchema>;

export const hoursKeys = {
  overview: ["hours"] as const,
  sessions: (from: string) => ["hours", "sessions", from] as const,
  payouts: (ruleId: string) => ["hours", "payouts", ruleId] as const,
};

export function useOverview(enabled = true) {
  return useQuery({
    queryKey: hoursKeys.overview,
    enabled,
    queryFn: async ({ signal }) =>
      workHoursOverviewSchema.parse(await api.request("hours", { signal })),
  });
}

export function useSessions(from: string) {
  return useQuery({
    queryKey: hoursKeys.sessions(from),
    queryFn: async ({ signal }) =>
      sessionsResponseSchema.parse(
        await api.request("hours/sessions", { signal, query: { from } }),
      ).sessions,
    placeholderData: (previous) => previous,
  });
}

export function usePayouts(ruleId: string) {
  return useQuery({
    queryKey: hoursKeys.payouts(ruleId),
    queryFn: async ({ signal }) =>
      financePayoutScheduleResponseSchema.parse(
        await api.request(
          `finance/rules/${encodeURIComponent(ruleId)}/payouts`,
          { signal },
        ),
      ),
  });
}

/** Every write re-reads the whole tracker: totals and pay periods all move. */
function useHoursMutation<Variables>(
  mutationFn: (variables: Variables) => Promise<unknown>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => client.invalidateQueries({ queryKey: ["hours"] }),
  });
}

export function useClock() {
  return useHoursMutation((input: WorkClockAction) =>
    api.request("hours/clock", { method: "POST", body: input }),
  );
}

export function useSaveSession() {
  return useHoursMutation(
    (
      input:
        | { id: string; patch: WorkSessionUpdate }
        | { create: SessionCreate },
    ) =>
      "create" in input
        ? api.request("hours/sessions", { method: "POST", body: input.create })
        : api.request(`hours/sessions/${input.id}`, {
            method: "PATCH",
            body: input.patch,
          }),
  );
}

export function useDeleteSession() {
  return useHoursMutation((id: string) =>
    api.request(`hours/sessions/${id}`, { method: "DELETE" }),
  );
}

export function useSaveJob() {
  return useHoursMutation(
    (
      input:
        | { id: string; patch: WorkJobUpdatePayload }
        | { create: WorkJobInputPayload },
    ) =>
      "create" in input
        ? api.request("hours/jobs", { method: "POST", body: input.create })
        : api.request(`hours/jobs/${input.id}`, {
            method: "PATCH",
            body: input.patch,
          }),
  );
}
