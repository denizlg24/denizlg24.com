import type {
  MacrosBulkDeleteEntriesResponse,
  MacrosCalendarTotals,
  MacrosCopyLogResponse,
  MacrosDailyMacros,
  MacrosDayNoteResponse,
  MacrosDeleteLogEntryResponse,
  MacrosDuplicateLogEntryResponse,
  MacrosFoodLogActivityResponse,
  MacrosFoodLogDay,
  MacrosFoodLogEntry,
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
import { useCallback } from "react";
import type { z } from "zod";
import { ApiError, api, errorMessage } from "@/lib/api";
import { applyEntryEdit, withEntry, withoutEntry } from "@/lib/entry-edit";
import { recordFailedWrite } from "@/lib/failed-writes";
import { newClientMutationId } from "@/lib/ids";
import { invalidateAfterLogging, queryKeys } from "./keys";
import {
  carryFetchStamp,
  confirmPendingLog,
  dropPendingLog,
  fetchStamped,
  recordPendingLog,
  usePendingLogs,
  withPendingCalendar,
  withPendingDay,
} from "./pending-logs";

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
  updateEntry: ["food-log", "update-entry"] as const,
  deleteEntry: ["food-log", "delete-entry"] as const,
  placeEntries: ["food-log", "place-entries"] as const,
  bulkDelete: ["food-log", "bulk-delete"] as const,
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

/**
 * Paused writes resume all at once; one scope replays them in the order they
 * were made, so an edit cannot land after the delete that followed it.
 */
const logScope = { id: "food-log" };

const entryEditId = ({ id }: { id: string }) => `edit:${id}`;
const entryDeleteId = (id: string) => `delete:${id}`;

const unsettledDates = new Set<string>();

/**
 * The scope runs log writes one at a time, so refetching after each one steps
 * the totals through partial states underneath the optimistic ones. Only the
 * last write still queued refetches, for every day the queue touched.
 */
function settleLogWrite(queryClient: QueryClient, logDate?: string) {
  if (logDate) unsettledDates.add(logDate);
  if (queryClient.isMutating({ mutationKey: queryKeys.foodLog }) > 1) return;
  const dates = [...unsettledDates];
  unsettledDates.clear();
  return invalidateAfterLogging(queryClient, dates);
}

/**
 * Counts a log in the totals before the server has it: the phone already
 * knows what was eaten, and the ring, the pill and the day's totals waiting
 * on a round trip read as the log not having worked. The amounts are added
 * where the totals are read, so no refetch landing mid-write can undo them.
 */
export function showLogged(
  clientMutationId: string | undefined,
  logDate: string | undefined,
  macros: MacrosDailyMacros,
) {
  if (!clientMutationId || !logDate) return;
  recordPendingLog(clientMutationId, logDate, macros);
}

export function registerLogMutationDefaults(queryClient: QueryClient) {
  const onSuccess = (_data: unknown, variables: { logDate?: string }) =>
    settleLogWrite(queryClient, variables.logDate);
  const onLogged = (
    _data: unknown,
    variables: { logDate?: string; clientMutationId?: string },
  ) => {
    confirmPendingLog(variables.clientMutationId);
    return settleLogWrite(queryClient, variables.logDate);
  };
  const onError =
    (description: string) =>
    (error: Error, variables: { clientMutationId?: string }) => {
      dropPendingLog(variables.clientMutationId);
      recordFailedWrite(description, errorMessage(error), {
        id: variables.clientMutationId,
      });
      return invalidateAfterLogging(queryClient);
    };
  queryClient.setMutationDefaults(logMutationKeys.logFood, {
    scope: logScope,
    mutationFn: logFood,
    onSuccess: onLogged,
    onError: onError("A logged food"),
  });
  queryClient.setMutationDefaults(logMutationKeys.quickAdd, {
    scope: logScope,
    mutationFn: quickAdd,
    onSuccess: onLogged,
    onError: onError("A quick add"),
  });
  queryClient.setMutationDefaults(logMutationKeys.logRecipe, {
    scope: logScope,
    mutationFn: logRecipe,
    onSuccess: onLogged,
    onError: onError("A logged recipe"),
  });
  // Keyed by what the write touches, so the screen and the default reporting
  // one live failure make one notice.
  const onEditError =
    <T>(description: string, key: (variables: T) => string) =>
    (error: Error, variables: T) => {
      recordFailedWrite(description, errorMessage(error), {
        id: key(variables),
      });
      return invalidateAfterLogging(queryClient);
    };
  queryClient.setMutationDefaults(logMutationKeys.updateEntry, {
    mutationFn: updateEntry,
    scope: logScope,
    onSuccess,
    onError: onEditError("An edited entry", entryEditId),
  });
  queryClient.setMutationDefaults(logMutationKeys.deleteEntry, {
    mutationFn: deleteEntry,
    scope: logScope,
    onSuccess: () => invalidateAfterLogging(queryClient),
    onError: onEditError("A deleted entry", entryDeleteId),
  });
  queryClient.setMutationDefaults(logMutationKeys.placeEntries, {
    mutationFn: moveEntries,
    scope: logScope,
    onSuccess,
    onError: onEditError(
      "Moved entries",
      (body: MoveEntriesInput) => `place:${body.entryIds.join(",")}`,
    ),
  });
  queryClient.setMutationDefaults(logMutationKeys.bulkDelete, {
    mutationFn: bulkDeleteEntries,
    scope: logScope,
    onSuccess: () => invalidateAfterLogging(queryClient),
    onError: onEditError(
      "Deleted entries",
      (body: BulkDeleteInput) => `bulk-delete:${body.entryIds.join(",")}`,
    ),
  });
}

export function fetchFoodLogDay(date: string, signal?: AbortSignal) {
  return fetchStamped(() =>
    api<MacrosFoodLogDay>("/api/food-log/day", {
      query: { date },
      signal,
    }),
  );
}

export function useFoodLogDay(date: string) {
  const pending = usePendingLogs();
  return useQuery({
    queryKey: queryKeys.foodLogDay(date),
    queryFn: ({ signal }) => fetchFoodLogDay(date, signal),
    select: useCallback(
      (day: MacrosFoodLogDay) => withPendingDay(day, pending),
      [pending],
    ),
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

type UpdateEntryVariables = UpdateEntryInput & { id: string };

function updateEntry({ id, ...body }: UpdateEntryVariables) {
  return api<MacrosUpdateLogEntryResponse>(`/api/food-log/entries/${id}`, {
    method: "PATCH",
    body,
  });
}

/** A replayed delete finding the entry already gone has done its job. */
async function deleteEntry(id: string) {
  try {
    await api<MacrosDeleteLogEntryResponse>(`/api/food-log/entries/${id}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

function bulkDeleteEntries(body: BulkDeleteInput) {
  return api<MacrosBulkDeleteEntriesResponse>("/api/food-log/entries/actions", {
    method: "DELETE",
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
    mutationKey: logMutationKeys.updateEntry,
    mutationFn: updateEntry,
    onSuccess: (_data, { logDate }) =>
      invalidateAfterLogging(queryClient, [logDate]),
  });
}

/**
 * An edit shown at once and run under its registered defaults: offline it
 * waits for the network instead of holding a sheet open, and a refusal lands
 * in the failed-writes notice like a queued log. The log's drag-to-retime
 * goes through here too, so a dropped row never jumps back while it saves.
 */
export function queueEntryUpdate(
  queryClient: QueryClient,
  entry: MacrosFoodLogEntry,
  edit: UpdateEntryInput,
) {
  // Show the edit now: the row keeping its old amount invites a second edit.
  const edited = applyEntryEdit(entry, edit);
  if (edited.logDate !== entry.logDate) {
    queryClient.setQueryData<MacrosFoodLogDay>(
      queryKeys.foodLogDay(entry.logDate),
      (day) => (day ? carryFetchStamp(day, withoutEntry(day, entry)) : day),
    );
  }
  queryClient.setQueryData<MacrosFoodLogDay>(
    queryKeys.foodLogDay(edited.logDate),
    (day) => (day ? carryFetchStamp(day, withEntry(day, edited)) : day),
  );
  const variables: UpdateEntryVariables = { id: entry.id, ...edit };
  void queryClient
    .getMutationCache()
    .build(queryClient, { mutationKey: logMutationKeys.updateEntry })
    .execute(variables)
    .catch(() => undefined);
}

/** Removes the row from the cached day at once; restores it if the server refuses. */
export function useDeleteEntry(date: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.foodLogDay(date);
  return useMutation({
    mutationKey: logMutationKeys.deleteEntry,
    mutationFn: deleteEntry,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MacrosFoodLogDay>(key);
      if (previous) {
        queryClient.setQueryData<MacrosFoodLogDay>(
          key,
          carryFetchStamp(previous, {
            ...previous,
            entries: previous.entries.filter((entry) => entry.id !== id),
          }),
        );
      }
      return { previous };
    },
    // Deletes commit after the row's undo window, often once the screen that
    // scheduled them is gone, so the failure is recorded rather than shown.
    onError: (error, id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      recordFailedWrite("A deleted entry", errorMessage(error), {
        id: entryDeleteId(id),
      });
    },
    onSettled: () => invalidateAfterLogging(queryClient, [date]),
  });
}

/** A second copy of an entry; the server times it with the original. */
export function useDuplicateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    // Creates rows: a retry after a lost response would create them twice.
    retry: false,
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
    mutationKey: logMutationKeys.placeEntries,
    mutationFn: moveEntries,
    onSettled: (_data, _error, { logDate }) =>
      invalidateAfterLogging(queryClient, [logDate]),
  });
}

export function useBulkDeleteEntries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: logMutationKeys.bulkDelete,
    mutationFn: bulkDeleteEntries,
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
    // Creates rows: a retry after a lost response would create them twice.
    retry: false,
    mutationFn: copyEntries,
    onSettled: (_data, _error, { targetDate }) =>
      invalidateAfterLogging(queryClient, [targetDate]),
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
        (day) => (day ? carryFetchStamp(day, { ...day, note }) : day),
      );
    },
  });
}

function usePendingCalendar() {
  const pending = usePendingLogs();
  return useCallback(
    (totals: MacrosCalendarTotals) => withPendingCalendar(totals, pending),
    [pending],
  );
}

export function useCalendarTotals(start: string, end: string) {
  return useQuery({
    queryKey: ["food-log", "calendar", start, end],
    queryFn: ({ signal }) =>
      fetchStamped(() =>
        api<MacrosCalendarTotals>("/api/food-log/calendar-totals", {
          query: { start, end },
          signal,
        }),
      ),
    select: usePendingCalendar(),
  });
}

export function useWeekTotals(start: string, end: string) {
  return useQuery({
    queryKey: ["food-log", "week", start, end],
    queryFn: ({ signal }) =>
      fetchStamped(() =>
        api<MacrosWeekTotals>("/api/food-log/week-totals", {
          query: { start, end },
          signal,
        }),
      ),
    select: usePendingCalendar(),
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
