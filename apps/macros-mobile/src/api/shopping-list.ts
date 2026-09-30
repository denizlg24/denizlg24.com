import type {
  MacrosOkResponse,
  MacrosShoppingListClearResponse,
  MacrosShoppingListItem,
  MacrosShoppingListItemResponse,
  MacrosShoppingListResponse,
  macrosCreateShoppingListItemBodySchema,
  macrosReorderShoppingListBodySchema,
  macrosUpdateShoppingListItemBodySchema,
} from "@repo/schemas/macros";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import { ApiError, api, errorMessage } from "@/lib/api";
import { recordFailedWrite } from "@/lib/failed-writes";
import { queryKeys } from "./keys";

export type ShoppingListItem = MacrosShoppingListItem;
export type AddShoppingListItemInput = z.input<
  typeof macrosCreateShoppingListItemBodySchema
>;
export type UpdateShoppingListItemInput = z.input<
  typeof macrosUpdateShoppingListItemBodySchema
>;
type ReorderShoppingListInput = z.input<
  typeof macrosReorderShoppingListBodySchema
>;

export const shoppingListKeys = {
  items: [...queryKeys.shoppingList, "items"] as const,
};

const writeKey = [...queryKeys.shoppingList, "write"] as const;

/**
 * One key per write, under `writeKey`, so a write paused in a shop with no
 * signal finds its function again after a relaunch.
 */
const writeKeys = {
  add: [...writeKey, "add"] as const,
  update: [...writeKey, "update"] as const,
  delete: [...writeKey, "delete"] as const,
  clearChecked: [...writeKey, "clear-checked"] as const,
  reorder: [...writeKey, "reorder"] as const,
};

type Items = ShoppingListItem[];

/** Stored order. The screen decides how checked lines are grouped. */
export function sortByPosition(items: readonly ShoppingListItem[]): Items {
  return [...items].sort(
    (left, right) =>
      left.position - right.position ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function useShoppingList() {
  return useQuery({
    queryKey: shoppingListKeys.items,
    queryFn: ({ signal }) =>
      api<MacrosShoppingListResponse>("/api/shopping-list", { signal }).then(
        (body) => sortByPosition(body.items),
      ),
  });
}

export function addShoppingListItem(input: AddShoppingListItemInput) {
  return api<MacrosShoppingListItemResponse>("/api/shopping-list", {
    method: "POST",
    body: input,
  }).then((body) => body.item);
}

function appendItems(
  queryClient: QueryClient,
  added: readonly ShoppingListItem[],
) {
  const current = queryClient.getQueryData<Items>(shoppingListKeys.items);
  if (!current) {
    void queryClient.invalidateQueries({ queryKey: shoppingListKeys.items });
    return;
  }
  const ids = new Set(added.map((item) => item.id));
  queryClient.setQueryData<Items>(shoppingListKeys.items, [
    ...current.filter((item) => !ids.has(item.id)),
    ...added,
  ]);
}

/**
 * Only the last write in flight refetches: an earlier response landing after
 * a later optimistic change would otherwise flick a row back for a moment.
 */
function settle(queryClient: QueryClient) {
  if (queryClient.isMutating({ mutationKey: writeKey }) === 1) {
    return queryClient.invalidateQueries({ queryKey: shoppingListKeys.items });
  }
  return undefined;
}

export function useAddShoppingListItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: writeKeys.add,
    mutationFn: addShoppingListItem,
    onSuccess: (item) => appendItems(queryClient, [item]),
  });
}

/** Sequential so the list keeps the order the lines were given in. */
export function useAddShoppingListItems() {
  const queryClient = useQueryClient();
  return useMutation({
    // Adds one by one: a retry would re-add every item before the failure.
    retry: false,
    mutationKey: writeKey,
    mutationFn: async (inputs: readonly AddShoppingListItemInput[]) => {
      const added: ShoppingListItem[] = [];
      for (const input of inputs) {
        added.push(await addShoppingListItem(input));
      }
      return added;
    },
    onSuccess: (items) => appendItems(queryClient, items),
    onError: () =>
      queryClient.invalidateQueries({ queryKey: shoppingListKeys.items }),
  });
}

type UpdateShoppingListVariables = UpdateShoppingListItemInput & {
  id: string;
};

function updateShoppingListItem({ id, ...body }: UpdateShoppingListVariables) {
  return api<MacrosShoppingListItemResponse>(`/api/shopping-list/${id}`, {
    method: "PATCH",
    body,
  }).then((response) => response.item);
}

/** A replayed delete finding the line already gone has done its job. */
async function deleteShoppingListItem(id: string) {
  try {
    await api<MacrosOkResponse>(`/api/shopping-list/${id}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

function clearCheckedShoppingList() {
  return api<MacrosShoppingListClearResponse>("/api/shopping-list", {
    method: "DELETE",
  });
}

function reorderShoppingList(body: ReorderShoppingListInput) {
  return api<MacrosShoppingListResponse>("/api/shopping-list/reorder", {
    method: "PATCH",
    body,
  }).then((response) => sortByPosition(response.items));
}

export function registerShoppingListMutationDefaults(queryClient: QueryClient) {
  const onSettled = () => settle(queryClient);
  // One scope replays paused writes in the order they were made: a reorder
  // landing after a delete is refused for naming a line that is gone.
  const scope = { id: "shopping-list" };
  const onError = (description: string) => (error: Error) =>
    recordFailedWrite(description, errorMessage(error));
  queryClient.setMutationDefaults(writeKeys.add, {
    scope,
    onError: onError("An added shopping item"),
    mutationFn: addShoppingListItem,
    onSettled,
  });
  queryClient.setMutationDefaults(writeKeys.update, {
    scope,
    onError: onError("A shopping list change"),
    mutationFn: updateShoppingListItem,
    onSettled,
  });
  queryClient.setMutationDefaults(writeKeys.delete, {
    scope,
    onError: onError("A removed shopping item"),
    mutationFn: deleteShoppingListItem,
    onSettled,
  });
  queryClient.setMutationDefaults(writeKeys.clearChecked, {
    scope,
    onError: onError("Clearing ticked items"),
    mutationFn: clearCheckedShoppingList,
    onSettled,
  });
  queryClient.setMutationDefaults(writeKeys.reorder, {
    scope,
    onError: onError("A shopping list reorder"),
    mutationFn: reorderShoppingList,
    onSettled,
  });
}

function applyPatch(
  item: ShoppingListItem,
  patch: UpdateShoppingListItemInput,
): ShoppingListItem {
  return {
    ...item,
    ...(patch.label === undefined ? {} : { label: patch.label.trim() }),
    ...(patch.note === undefined ? {} : { note: patch.note.trim() || null }),
    ...(patch.iconKey === undefined ? {} : { iconKey: patch.iconKey }),
    ...(patch.checked === undefined ? {} : { checked: patch.checked }),
  };
}

async function optimistic(
  queryClient: QueryClient,
  update: (items: Items) => Items,
) {
  await queryClient.cancelQueries({ queryKey: shoppingListKeys.items });
  const previous = queryClient.getQueryData<Items>(shoppingListKeys.items);
  if (previous) {
    queryClient.setQueryData<Items>(shoppingListKeys.items, update(previous));
  }
  return { previous };
}

function rollback(
  queryClient: QueryClient,
  context: { previous: Items | undefined } | undefined,
) {
  if (context?.previous) {
    queryClient.setQueryData(shoppingListKeys.items, context.previous);
  }
}

export function useUpdateShoppingListItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: writeKeys.update,
    mutationFn: updateShoppingListItem,
    onMutate: ({ id, ...patch }) =>
      optimistic(queryClient, (items) =>
        items.map((item) => (item.id === id ? applyPatch(item, patch) : item)),
      ),
    onError: (_error, _input, context) => rollback(queryClient, context),
    onSettled: () => settle(queryClient),
  });
}

export function useDeleteShoppingListItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: writeKeys.delete,
    mutationFn: deleteShoppingListItem,
    onMutate: (id) =>
      optimistic(queryClient, (items) =>
        items.filter((item) => item.id !== id),
      ),
    onError: (_error, _id, context) => rollback(queryClient, context),
    onSettled: () => settle(queryClient),
  });
}

export function useClearCheckedShoppingList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: writeKeys.clearChecked,
    mutationFn: clearCheckedShoppingList,
    onMutate: () =>
      optimistic(queryClient, (items) => items.filter((item) => !item.checked)),
    onError: (_error, _input, context) => rollback(queryClient, context),
    onSettled: () => settle(queryClient),
  });
}

/** The server rewrites every position, so `itemIds` must name the whole list. */
export function useReorderShoppingList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: writeKeys.reorder,
    mutationFn: reorderShoppingList,
    onMutate: ({ itemIds }) =>
      optimistic(queryClient, (items) => {
        const byId = new Map(items.map((item) => [item.id, item]));
        return itemIds.flatMap((id, position) => {
          const item = byId.get(id);
          return item ? [{ ...item, position }] : [];
        });
      }),
    onError: (_error, _input, context) => rollback(queryClient, context),
    onSettled: () => settle(queryClient),
  });
}
