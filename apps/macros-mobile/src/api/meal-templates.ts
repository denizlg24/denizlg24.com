import type {
  MacrosCreateMealTemplateResponse,
  MacrosLogMealTemplateResponse,
  MacrosMealTemplatesResponse,
  MacrosOkResponse,
  macrosCreateMealTemplateBodySchema,
  macrosLogMealTemplateBodySchema,
} from "@repo/schemas/macros";
import {
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
import { confirmPendingLog, dropPendingLog } from "./pending-logs";

export type LogMealTemplateInput = z.input<
  typeof macrosLogMealTemplateBodySchema
>;
export type CreateMealTemplateInput = z.input<
  typeof macrosCreateMealTemplateBodySchema
>;

type MealTemplate = MacrosMealTemplatesResponse["items"][number];

export const mealTemplateKeys = {
  list: [...queryKeys.mealTemplates, "list"] as const,
};

export const mealTemplateMutationKeys = {
  log: ["food-log", "log-meal-template"] as const,
};

export function useMealTemplates() {
  return useQuery({
    queryKey: mealTemplateKeys.list,
    queryFn: ({ signal }) =>
      api<MacrosMealTemplatesResponse>("/api/meal-templates", { signal }).then(
        (body) => body.items,
      ),
  });
}

// Standalone so a paused write restored after a relaunch can find its function.
export function logMealTemplate(input: LogMealTemplateInput) {
  return api<MacrosLogMealTemplateResponse>("/api/meal-templates/log", {
    method: "POST",
    body: input,
  });
}

export function registerMealTemplateMutationDefaults(queryClient: QueryClient) {
  queryClient.setMutationDefaults(mealTemplateMutationKeys.log, {
    mutationFn: logMealTemplate,
    onSuccess: (_data, variables: LogMealTemplateInput) => {
      confirmPendingLog(variables.clientMutationId);
      return invalidateAfterLogging(queryClient, [variables.logDate]);
    },
    onError: (error: Error, variables: LogMealTemplateInput) => {
      dropPendingLog(variables.clientMutationId);
      recordFailedWrite("A logged meal", errorMessage(error), {
        id: variables.clientMutationId,
      });
    },
  });
}

/**
 * Offline-safe like single-food logs: the idempotency key is stamped before
 * the write is queued, and the server returns the original entries on replay.
 */
export function useLogMealTemplate() {
  const mutation = useMutation<
    MacrosLogMealTemplateResponse,
    Error,
    LogMealTemplateInput
  >({ mutationKey: mealTemplateMutationKeys.log });
  return {
    ...mutation,
    mutateAsync: (input: LogMealTemplateInput) =>
      mutation.mutateAsync({
        ...input,
        clientMutationId: input.clientMutationId ?? newClientMutationId(),
      }),
  };
}

/** Saves logged entries as a reusable meal; used from the Log tab's selection. */
export function useCreateMealTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    // Creates rows: a retry after a lost response would create them twice.
    retry: false,
    mutationFn: (body: CreateMealTemplateInput) =>
      api<MacrosCreateMealTemplateResponse>("/api/meal-templates", {
        method: "POST",
        body,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.mealTemplates }),
  });
}

/** Takes a saved meal off the list; what was logged from it stays logged. */
export function useDeleteMealTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MacrosOkResponse>(`/api/meal-templates/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: mealTemplateKeys.list });
      const previous = queryClient.getQueryData<MealTemplate[]>(
        mealTemplateKeys.list,
      );
      if (previous) {
        queryClient.setQueryData<MealTemplate[]>(
          mealTemplateKeys.list,
          previous.filter((template) => template.id !== id),
        );
      }
      return { previous };
    },
    onError: (error, id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(mealTemplateKeys.list, context.previous);
      }
      recordFailedWrite("A deleted meal", errorMessage(error), {
        id: `delete-meal:${id}`,
      });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.mealTemplates }),
  });
}
