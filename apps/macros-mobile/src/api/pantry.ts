import { stockStatus } from "@repo/macros-core/pantry";
import type {
  MacrosPantryItem,
  MacrosPantryResponse,
  MacrosSetPantryItemBody,
  MacrosSetPantryRecipeBody,
  macrosStorePantryRecipeBodySchema,
} from "@repo/schemas/macros";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import { api, apiVoid } from "@/lib/api";
import { queryKeys } from "./keys";

export const pantryKey = ["pantry"] as const;
const setKey = ["pantry", "set"] as const;

export function usePantry() {
  return useQuery({
    queryKey: pantryKey,
    queryFn: ({ signal }) =>
      api<MacrosPantryResponse>("/api/pantry", { signal }),
  });
}

/** Stock decides search order and which recipes can be cooked. */
function invalidateDependents(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["foods", "search"] }),
    client.invalidateQueries({ queryKey: queryKeys.recipes }),
  ]);
}

/**
 * The stock a set leaves, for a row already in the pantry. A body with a
 * `basis` needs the server's conversion, so it waits for the answer instead.
 */
function applySet(
  item: MacrosPantryItem,
  body: MacrosSetPantryItemBody,
): MacrosPantryItem {
  const unit = body.unit ?? item.unit;
  const servingsPerUnit = unit?.servingsPerUnit ?? 1;
  const quantity = body.unit
    ? body.quantity * body.unit.servingsPerUnit
    : body.quantity;
  return {
    ...item,
    quantity,
    unit,
    unitQuantity: quantity / servingsPerUnit,
    status: stockStatus(quantity, servingsPerUnit),
  };
}

/**
 * Online only, never queued: the count is absolute, so one replayed late
 * would erase whatever was eaten in between. A stepper tap shows at once;
 * only the last set in flight writes the server's answer back, so an earlier
 * response landing late cannot step the row backwards.
 */
export function useSetPantryItem() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: setKey,
    networkMode: "always",
    retry: false,
    mutationFn: (body: MacrosSetPantryItemBody) =>
      api<MacrosPantryResponse>("/api/pantry", { method: "PUT", body }),
    onMutate: async (body) => {
      const previous = client.getQueryData<MacrosPantryResponse>(pantryKey);
      if (!previous || body.basis) return { previous: undefined };
      await client.cancelQueries({ queryKey: pantryKey });
      client.setQueryData<MacrosPantryResponse>(pantryKey, {
        ...previous,
        items: previous.items.map((item) =>
          item.item.id === body.sourceItemId ? applySet(item, body) : item,
        ),
      });
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous) client.setQueryData(pantryKey, context.previous);
    },
    onSuccess: (data) => {
      if (client.isMutating({ mutationKey: setKey }) === 1)
        client.setQueryData(pantryKey, data);
    },
    onSettled: () => invalidateDependents(client),
  });
}

export function useRemovePantryItem() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["pantry", "remove"],
    networkMode: "always",
    retry: false,
    mutationFn: (id: string) =>
      apiVoid(`/api/pantry/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: pantryKey }),
        invalidateDependents(client),
      ]),
  });
}

const recipeSetKey = ["pantry", "recipe", "set"] as const;

/**
 * Stored servings of a recipe, set outright. Online only for the same
 * reason as a food's count; the stepper shows at once and only the last set
 * in flight writes the answer back.
 */
export function useSetPantryRecipe() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: recipeSetKey,
    networkMode: "always",
    retry: false,
    mutationFn: (body: MacrosSetPantryRecipeBody) =>
      api<MacrosPantryResponse>("/api/pantry/recipes", { method: "PUT", body }),
    onMutate: async (body) => {
      const previous = client.getQueryData<MacrosPantryResponse>(pantryKey);
      if (!previous?.recipes) return { previous: undefined };
      await client.cancelQueries({ queryKey: pantryKey });
      client.setQueryData<MacrosPantryResponse>(pantryKey, {
        ...previous,
        recipes: previous.recipes.map((stored) =>
          stored.recipeId === body.recipeId
            ? {
                ...stored,
                quantity: body.quantity,
                status: stockStatus(body.quantity, 1),
              }
            : stored,
        ),
      });
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous) client.setQueryData(pantryKey, context.previous);
    },
    onSuccess: (data) => {
      if (client.isMutating({ mutationKey: recipeSetKey }) === 1)
        client.setQueryData(pantryKey, data);
    },
    onSettled: () => invalidateDependents(client),
  });
}

export type StorePantryRecipeInput = z.input<
  typeof macrosStorePantryRecipeBodySchema
>;

/** A batch just cooked goes in; its ingredients come out when asked. */
export function useStorePantryRecipe() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["pantry", "recipe", "store"],
    networkMode: "always",
    // Adds servings: a retry after a lost answer would store them twice.
    retry: false,
    mutationFn: (body: StorePantryRecipeInput) =>
      api<MacrosPantryResponse>("/api/pantry/recipes", {
        method: "POST",
        body,
      }),
    onSuccess: (data) => client.setQueryData(pantryKey, data),
    onSettled: () => invalidateDependents(client),
  });
}
