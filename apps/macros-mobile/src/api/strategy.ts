import type {
  MacrosAcceptIssueResponse,
  MacrosCheckInResponse,
  MacrosProgramsResponse,
  MacrosStrategyResponse,
  MacrosUpsertProgramResponse,
  macrosCheckInBodySchema,
  macrosUpsertProgramBodySchema,
} from "@repo/schemas/macros";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import { api } from "@/lib/api";
import { queryKeys } from "./keys";

export type ProgramInput = z.input<typeof macrosUpsertProgramBodySchema>;
export type CheckInInput = z.input<typeof macrosCheckInBodySchema>;

export const strategyKeys = {
  overview: [...queryKeys.strategy, "overview"] as const,
  checkIn: [...queryKeys.strategy, "check-in"] as const,
  program: queryKeys.program,
};

/** The active target issue with its per-weekday days, the active goal and goal history. */
export function useStrategy() {
  return useQuery({
    queryKey: strategyKeys.overview,
    queryFn: ({ signal }) =>
      api<MacrosStrategyResponse>("/api/strategy", { signal }),
  });
}

/** The durable program plus every target issue it has produced, newest first. */
export function useNutritionProgram() {
  return useQuery({
    queryKey: strategyKeys.program,
    queryFn: ({ signal }) =>
      api<MacrosProgramsResponse>("/api/nutrition-programs", { signal }),
  });
}

/** A new or changed target moves today's budget everywhere it is shown. */
export function invalidateAfterTargetChange(queryClient: QueryClient) {
  return Promise.all(
    [
      queryKeys.strategy,
      queryKeys.program,
      ["dashboard"],
      ["calorie-summary"],
      queryKeys.foodLog,
      queryKeys.statistics,
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

export function saveProgram(body: ProgramInput) {
  return api<MacrosUpsertProgramResponse>("/api/nutrition-programs", {
    method: "PUT",
    body,
  });
}

/** Saving always issues a fresh target (`program_change`, or `onboarding` for a first program). */
export function useSaveProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveProgram,
    onSuccess: () => invalidateAfterTargetChange(queryClient),
  });
}

/** Collaborative mode: a check-in proposes targets that wait for this. */
export function useAcceptIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MacrosAcceptIssueResponse>(
        `/api/nutrition-programs/issues/${id}/accept`,
        { method: "POST" },
      ),
    onSuccess: () => invalidateAfterTargetChange(queryClient),
  });
}

/** Whether a check-in is due, last week's recap and the engine's proposal. 409 without a program. */
export function useCheckIn({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: strategyKeys.checkIn,
    queryFn: ({ signal }) =>
      api<MacrosCheckInResponse>("/api/nutrition-programs/check-in", {
        signal,
      }),
    enabled,
  });
}

/** Saves the (possibly edited) program and goal, then issues this week's targets. */
export function useSubmitCheckIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CheckInInput) =>
      api<MacrosUpsertProgramResponse>("/api/nutrition-programs/check-in", {
        method: "POST",
        body,
      }),
    // The check-in recomputed trend and expenditure as well.
    onSuccess: () =>
      Promise.all([
        invalidateAfterTargetChange(queryClient),
        queryClient.invalidateQueries({ queryKey: queryKeys.weight }),
      ]),
  });
}
