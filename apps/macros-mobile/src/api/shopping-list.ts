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
import { api } from "@/lib/api";
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
    mutationKey: writeKey,
    mutationFn: addShoppingListItem,
    onSuccess: (item) => appendItems(queryClient, [item]),
  });
}

/** Sequential so the list keeps the order the lines were given in. */
export function useAddShoppingListItems() {
  const queryClient = useQueryClient();
  return useMutation({
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
    mutationKey: writeKey,
    mutationFn: ({
      id,
      ...body
    }: UpdateShoppingListItemInput & { id: string }) =>
      api<MacrosShoppingListItemResponse>(`/api/shopping-list/${id}`, {
        method: "PATCH",
        body,
      }).then((response) => response.item),
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
    mutationKey: writeKey,
    mutationFn: (id: string) =>
      api<MacrosOkResponse>(`/api/shopping-list/${id}`, { method: "DELETE" }),
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
    mutationKey: writeKey,
    mutationFn: () =>
      api<MacrosShoppingListClearResponse>("/api/shopping-list", {
        method: "DELETE",
      }),
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
    mutationKey: writeKey,
    mutationFn: (body: ReorderShoppingListInput) =>
      api<MacrosShoppingListResponse>("/api/shopping-list/reorder", {
        method: "PATCH",
        body,
      }).then((response) => sortByPosition(response.items)),
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
