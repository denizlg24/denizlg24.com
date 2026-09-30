import type {
  MacrosDashboard,
  MacrosHabitCompletionResponse,
  MacrosHabitResponse,
  MacrosOkResponse,
  macrosHabitBodySchema,
  macrosHabitCompletionBodySchema,
  macrosUpdateHabitBodySchema,
} from "@repo/schemas/macros";
import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import { api, errorMessage } from "@/lib/api";
import { recordFailedWrite } from "@/lib/failed-writes";
import { type BodyOverview, bodyKeys } from "./body";
import { queryKeys } from "./keys";

export type CreateHabitInput = z.input<typeof macrosHabitBodySchema>;
export type UpdateHabitInput = z.input<typeof macrosUpdateHabitBodySchema>;
export type Habit = BodyOverview["habits"][number];

/** Habits and their completions arrive with the body overview (`useBodyOverview`). */
export function useCreateHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateHabitInput) =>
      api<MacrosHabitResponse>("/api/habits", { method: "POST", body }).then(
        (response) => response.habit,
      ),
    onSuccess: () => refreshHabits(queryClient),
  });
}

function refreshHabits(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: bodyKeys.overview }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
}

export function useUpdateHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateHabitInput & { id: string }) =>
      api<MacrosHabitResponse>(`/api/habits/${id}`, {
        method: "PATCH",
        body,
      }).then((response) => response.habit),
    onSuccess: () => refreshHabits(queryClient),
  });
}

/** Archives: the habit leaves every list, its history stays on the server. */
export function useArchiveHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MacrosOkResponse>(`/api/habits/${id}`, { method: "DELETE" }),
    onSuccess: () => refreshHabits(queryClient),
  });
}

export type HabitCompletionInput = z.input<
  typeof macrosHabitCompletionBodySchema
> & { habitId: string };

export const habitCompletionKey = ["body", "habit-completion"] as const;

export function setHabitCompletion({ habitId, ...body }: HabitCompletionInput) {
  return api<MacrosHabitCompletionResponse>(
    `/api/habits/${habitId}/completion`,
    { method: "PUT", body },
  );
}

function refreshAfterCompletion(queryClient: QueryClient) {
  // A refetch started while another tick is in flight would land the
  // server's older state over it; the last settling tick refreshes.
  if (queryClient.isMutating({ mutationKey: habitCompletionKey }) > 1) {
    return undefined;
  }
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.body }),
  ]);
}

/**
 * How a tick queued offline finds its function after a relaunch. A live tick
 * uses the hook's own handlers instead, which roll back in place; only a
 * replayed tick has no screen left to report to.
 */
export function registerHabitMutationDefaults(queryClient: QueryClient) {
  queryClient.setMutationDefaults(habitCompletionKey, {
    mutationFn: setHabitCompletion,
    onError: (error: Error) => {
      recordFailedWrite("A habit tick", errorMessage(error));
    },
    onSettled: () => refreshAfterCompletion(queryClient),
  });
}

function withCompletion<T extends { id: string; completedDates: string[] }>(
  habits: T[],
  { habitId, logDate, completed }: HabitCompletionInput,
): T[] {
  return habits.map((habit) => {
    if (habit.id !== habitId) return habit;
    const others = habit.completedDates.filter((date) => date !== logDate);
    return {
      ...habit,
      completedDates: completed ? [...others, logDate].sort() : others,
    };
  });
}

interface CompletionSnapshot {
  dashboards: [QueryKey, MacrosDashboard | undefined][];
  body: BodyOverview | undefined;
}

/**
 * Ticks the habit everywhere it is shown — every cached dashboard and the body
 * overview — at once, and restores both if the server refuses.
 */
export function useSetHabitCompletion() {
  const queryClient = useQueryClient();
  return useMutation<
    MacrosHabitCompletionResponse,
    Error,
    HabitCompletionInput,
    CompletionSnapshot
  >({
    mutationKey: habitCompletionKey,
    onMutate: async (input) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["dashboard"] }),
        queryClient.cancelQueries({ queryKey: bodyKeys.overview }),
      ]);
      const dashboards = queryClient.getQueriesData<MacrosDashboard>({
        queryKey: ["dashboard"],
      });
      const body = queryClient.getQueryData<BodyOverview>(bodyKeys.overview);
      queryClient.setQueriesData<MacrosDashboard>(
        { queryKey: ["dashboard"] },
        (dashboard) =>
          dashboard
            ? { ...dashboard, habits: withCompletion(dashboard.habits, input) }
            : dashboard,
      );
      if (body) {
        queryClient.setQueryData<BodyOverview>(bodyKeys.overview, {
          ...body,
          habits: withCompletion(body.habits, input),
        });
      }
      return { dashboards, body };
    },
    onError: (_error, _input, snapshot) => {
      if (!snapshot) return;
      for (const [key, data] of snapshot.dashboards) {
        queryClient.setQueryData(key, data);
      }
      if (snapshot.body) {
        queryClient.setQueryData(bodyKeys.overview, snapshot.body);
      }
    },
    onSettled: () => refreshAfterCompletion(queryClient),
  });
}
