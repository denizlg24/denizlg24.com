import type {
  MacrosBulkDeleteEntriesResponse,
  MacrosCalendarTotals,
  MacrosCopyLogResponse,
  MacrosDayNoteResponse,
  MacrosDeleteLogEntryResponse,
  MacrosDuplicateLogEntryResponse,
  MacrosFoodLogActivityResponse,
  MacrosFoodLogDay,
  MacrosLogFoodResponse,
  MacrosLogQuickAddResponse,
  MacrosLogRecipeResponse,
  MacrosMoveEntriesResponse,
  MacrosNutritionOverview,
  MacrosNutritionOverviewRange,
  MacrosUpdateLogEntryResponse,
  MacrosWeekTotals,
  macrosBulkDeleteEntriesBodySchema,
  macrosCopyLogBodySchema,
  macrosLogFoodBodySchema,
  macrosLogQuickAddBodySchema,
  macrosLogRecipeBodySchema,
  macrosMoveEntriesBodySchema,
  macrosUpdateLogEntryBodySchema,
} from "@repo/schemas/macros";
import {
  type MutateOptions,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import { api, errorMessage } from "@/lib/api";
import { recordFailedWrite } from "@/lib/failed-writes";
import { newClientMutationId } from "@/lib/ids";
import { invalidateAfterLogging, queryKeys } from "./keys";

export type LogFoodInput = z.input<typeof macrosLogFoodBodySchema>;
export type QuickAddInput = z.input<typeof macrosLogQuickAddBodySchema>;
export type LogRecipeInput = z.input<typeof macrosLogRecipeBodySchema>;
export type UpdateEntryInput = z.input<typeof macrosUpdateLogEntryBodySchema>;
export type MoveEntriesInput = z.input<typeof macrosMoveEntriesBodySchema>;
export type CopyLogInput = z.input<typeof macrosCopyLogBodySchema>;
export type BulkDeleteInput = z.input<typeof macrosBulkDeleteEntriesBodySchema>;

/** Mutation keys whose functions are registered on the client for offline replay. */
export const logMutationKeys = {
  logFood: ["food-log", "log-food"] as const,
  quickAdd: ["food-log", "quick-add"] as const,
  logRecipe: ["food-log", "log-recipe"] as const,
};

// Standalone so paused mutations restored from disk after a relaunch can be
// resumed: a persisted mutation carries its variables, not its function.
export function logFood(input: LogFoodInput) {
  return api<MacrosLogFoodResponse>("/api/food-log/entries", {
    method: "POST",
    body: input,
  });
}

export function quickAdd(input: QuickAddInput) {
  return api<MacrosLogQuickAddResponse>("/api/food-log/quick-add", {
    method: "POST",
    body: input,
  });
}

export function logRecipe(input: LogRecipeInput) {
  return api<MacrosLogRecipeResponse>("/api/food-log/recipe-entries", {
    method: "POST",
    body: input,
  });
}

export function registerLogMutationDefaults(queryClient: QueryClient) {
  const onSuccess = () => invalidateAfterLogging(queryClient);
  const onError =
    (description: string) =>
    (error: Error, variables: { clientMutationId?: string }) => {
      recordFailedWrite(description, errorMessage(error), {
        id: variables.clientMutationId,
      });
      return invalidateAfterLogging(queryClient);
    };
  queryClient.setMutationDefaults(logMutationKeys.logFood, {
    mutationFn: logFood,
    onSuccess,
    onError: onError("A logged food"),
  });
  queryClient.setMutationDefaults(logMutationKeys.quickAdd, {
    mutationFn: quickAdd,
    onSuccess,
    onError: onError("A quick add"),
  });
  queryClient.setMutationDefaults(logMutationKeys.logRecipe, {
    mutationFn: logRecipe,
    onSuccess,
    onError: onError("A logged recipe"),
  });
}

function fetchFoodLogDay(date: string, signal?: AbortSignal) {
  return api<MacrosFoodLogDay>("/api/food-log/day", {
    query: { date },
    signal,
  });
}

export function useFoodLogDay(date: string) {
  return useQuery({
    queryKey: queryKeys.foodLogDay(date),
    queryFn: ({ signal }) => fetchFoodLogDay(date, signal),
  });
}

function stamp<T extends { clientMutationId?: string }>(input: T): T {
  return input.clientMutationId
    ? input
    : { ...input, clientMutationId: newClientMutationId() };
}

// The idempotency key goes into the variables before the mutation is queued:
// variables are what gets persisted and replayed, so a key minted inside the
// mutation function would change on every replay.

export function useLogFood() {
  const mutation = useMutation<MacrosLogFoodResponse, Error, LogFoodInput>({
    mutationKey: logMutationKeys.logFood,
  });
  return {
    ...mutation,
    mutate: (
      input: LogFoodInput,
      options?: MutateOptions<MacrosLogFoodResponse, Error, LogFoodInput>,
    ) => mutation.mutate(stamp(input), options),
    mutateAsync: (input: LogFoodInput) => mutation.mutateAsync(stamp(input)),
  };
}

export function useQuickAdd() {
  const mutation = useMutation<MacrosLogQuickAddResponse, Error, QuickAddInput>(
    { mutationKey: logMutationKeys.quickAdd },
  );
  return {
    ...mutation,
    mutate: (
      input: QuickAddInput,
      options?: MutateOptions<MacrosLogQuickAddResponse, Error, QuickAddInput>,
    ) => mutation.mutate(stamp(input), options),
    mutateAsync: (input: QuickAddInput) => mutation.mutateAsync(stamp(input)),
  };
}

export function useLogRecipe() {
  const mutation = useMutation<MacrosLogRecipeResponse, Error, LogRecipeInput>({
    mutationKey: logMutationKeys.logRecipe,
  });
  return {
    ...mutation,
    mutate: (
      input: LogRecipeInput,
      options?: MutateOptions<MacrosLogRecipeResponse, Error, LogRecipeInput>,
    ) => mutation.mutate(stamp(input), options),
    mutateAsync: (input: LogRecipeInput) => mutation.mutateAsync(stamp(input)),
  };
}

function updateEntry(id: string, body: UpdateEntryInput) {
  return api<MacrosUpdateLogEntryResponse>(`/api/food-log/entries/${id}`, {
    method: "PATCH",
    body,
  });
}

function moveEntries(body: MoveEntriesInput) {
  return api<MacrosMoveEntriesResponse>("/api/food-log/entries/actions", {
    method: "PATCH",
    body,
  });
}

function duplicateEntry(id: string) {
  return api<MacrosDuplicateLogEntryResponse>(
    `/api/food-log/entries/${id}/duplicate`,
    { method: "POST" },
  );
}

export function useUpdateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateEntryInput & { id: string }) =>
      updateEntry(id, body),
    onSuccess: () => invalidateAfterLogging(queryClient),
  });
}

/** Removes the row from the cached day at once; restores it if the server refuses. */
export function useDeleteEntry(date: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.foodLogDay(date);
  return useMutation({
    mutationFn: (id: string) =>
      api<MacrosDeleteLogEntryResponse>(`/api/food-log/entries/${id}`, {
        method: "DELETE",
      }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MacrosFoodLogDay>(key);
      if (previous) {
        queryClient.setQueryData<MacrosFoodLogDay>(key, {
          ...previous,
          entries: previous.entries.filter((entry) => entry.id !== id),
        });
      }
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => invalidateAfterLogging(queryClient),
  });
}

/** A second copy of an entry; the server times it with the original. */
export function useDuplicateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await duplicateEntry(id)).entryId,
    onSettled: () => invalidateAfterLogging(queryClient),
  });
}

/**
 * Moves entries to another day (each keeping its time of day), sets them all
 * to one instant, or both, in one request.
 */
export function usePlaceEntries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MoveEntriesInput) => moveEntries(body),
    onSettled: () => invalidateAfterLogging(queryClient),
  });
}

export function useBulkDeleteEntries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkDeleteInput) =>
      api<MacrosBulkDeleteEntriesResponse>("/api/food-log/entries/actions", {
        method: "DELETE",
        body,
      }),
    onSuccess: () => invalidateAfterLogging(queryClient),
  });
}

/**
 * Copies a day, or the picked entries of it, onto another date; each copy
 * keeps its source's time of day there.
 */
function copyEntries(body: CopyLogInput) {
  return api<MacrosCopyLogResponse>("/api/food-log/copy", {
    method: "POST",
    body,
  });
}

export function useCopyEntries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: copyEntries,
    onSettled: () => invalidateAfterLogging(queryClient),
  });
}

export function useDayNote(date: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) =>
      api<MacrosDayNoteResponse>("/api/food-log/day-note", {
        method: "PUT",
        body: { logDate: date, note },
      }),
    onSuccess: ({ note }) => {
      queryClient.setQueryData<MacrosFoodLogDay>(
        queryKeys.foodLogDay(date),
        (day) => (day ? { ...day, note } : day),
      );
    },
  });
}

export function useCalendarTotals(start: string, end: string) {
  return useQuery({
    queryKey: ["food-log", "calendar", start, end],
    queryFn: ({ signal }) =>
      api<MacrosCalendarTotals>("/api/food-log/calendar-totals", {
        query: { start, end },
        signal,
      }),
  });
}

export function useWeekTotals(start: string, end: string) {
  return useQuery({
    queryKey: ["food-log", "week", start, end],
    queryFn: ({ signal }) =>
      api<MacrosWeekTotals>("/api/food-log/week-totals", {
        query: { start, end },
        signal,
      }),
  });
}

export function useNutritionOverview(
  range: MacrosNutritionOverviewRange,
  date?: string,
) {
  return useQuery({
    queryKey: ["food-log", "overview", range, date ?? null],
    queryFn: ({ signal }) =>
      api<MacrosNutritionOverview>("/api/food-log/overview", {
        query: { range, date },
        signal,
      }),
  });
}

export function useFoodLogActivity() {
  return useQuery({
    queryKey: ["food-log", "activity"],
    queryFn: ({ signal }) =>
      api<MacrosFoodLogActivityResponse>("/api/food-log/activity", {
        signal,
      }).then((body) => body.activity),
  });
}
