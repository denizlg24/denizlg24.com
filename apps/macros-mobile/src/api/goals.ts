import type {
  MacrosActiveGoalResponse,
  MacrosGoalHistoryResponse,
  MacrosGoalMutationResponse,
  macrosUpsertGoalBodySchema,
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

export type GoalInput = z.input<typeof macrosUpsertGoalBodySchema>;

// Goals live under the strategy prefix: the web strategy page reads the goal
// through `/api/strategy`, and weigh-in invalidation already covers it.
export const goalKeys = {
  active: [...queryKeys.strategy, "goal", "active"] as const,
  history: [...queryKeys.strategy, "goal", "history"] as const,
};

export function useActiveGoal() {
  return useQuery({
    queryKey: goalKeys.active,
    queryFn: ({ signal }) =>
      api<MacrosActiveGoalResponse>("/api/weight-goals", { signal }).then(
        (body) => body.goal,
      ),
  });
}

export function useGoalHistory() {
  return useQuery({
    queryKey: goalKeys.history,
    queryFn: ({ signal }) =>
      api<MacrosGoalHistoryResponse>("/api/weight-goals", {
        query: { history: "true" },
        signal,
      }).then((body) => body.history),
  });
}

/**
 * Every goal write re-issues nutrition targets on the server (reason
 * `goal_change`), so the targets and everything derived from them move too.
 */
export function invalidateAfterGoalChange(queryClient: QueryClient) {
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

export function createGoal(body: GoalInput) {
  return api<MacrosGoalMutationResponse>("/api/weight-goals", {
    method: "POST",
    body,
  });
}

/** Creates a goal when none is active, so it doubles as "set the rate". */
export function updateActiveGoal(body: GoalInput) {
  return api<MacrosGoalMutationResponse>("/api/weight-goals/active", {
    method: "PATCH",
    body,
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    // Creates rows: a retry after a lost response would create them twice.
    retry: false,
    mutationFn: createGoal,
    onSuccess: () => invalidateAfterGoalChange(queryClient),
  });
}

export function useUpdateActiveGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateActiveGoal,
    onSuccess: () => invalidateAfterGoalChange(queryClient),
  });
}

/** Closes the active goal (if any) and makes a past one active again. */
export function useReopenGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MacrosGoalMutationResponse>(`/api/weight-goals/${id}/reopen`, {
        method: "POST",
      }),
    onSuccess: () => invalidateAfterGoalChange(queryClient),
  });
}
