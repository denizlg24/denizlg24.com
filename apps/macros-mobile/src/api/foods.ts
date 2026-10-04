import type {
  MacrosCreateFoodResponse,
  MacrosDeleteFoodResponse,
  MacrosFavoritesResponse,
  MacrosFoodDetailResponse,
  MacrosFoodHistoryResponse,
  MacrosFoodMutationResponse,
  MacrosFoodSearchResponse,
  MacrosSaveFavoriteResponse,
  MacrosUserCustomFoodsResponse,
  macrosCreateFoodBodySchema,
  macrosFavoriteFoodBodySchema,
  macrosUpdateFoodBodySchema,
} from "@repo/schemas/macros";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import { ApiError, api, apiVoid } from "@/lib/api";
import { newClientMutationId } from "@/lib/ids";

export type CreateFoodInput = z.input<typeof macrosCreateFoodBodySchema>;
export type UpdateFoodInput = z.input<typeof macrosUpdateFoodBodySchema>;
export type FavoriteFoodInput = z.input<typeof macrosFavoriteFoodBodySchema>;

export const foodKeys = {
  search: (q: string) => ["foods", "search", q] as const,
  history: (hour: number | null) => ["foods", "history", hour] as const,
  detail: (id: string) => ["foods", "detail", id] as const,
  custom: ["foods", "custom"] as const,
  favorites: ["foods", "favorites"] as const,
};

/**
 * Callers pace `q` (one request in flight). The previous results stay on screen while the next
 * query is in flight so the list does not blank on every keystroke.
 */
export function useFoodSearch(q: string, limit = 25) {
  const query = q.trim();
  return useQuery({
    queryKey: foodKeys.search(query),
    queryFn: ({ signal }) =>
      api<MacrosFoodSearchResponse>("/api/foods/search", {
        query: { q: query, limit },
        signal,
      }),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

/**
 * Recently and frequently logged foods. `hour` biases the ranking toward what
 * is usually eaten at this time of day.
 */
export function useFoodHistory(hour: number | null = null, limit = 30) {
  return useQuery({
    queryKey: foodKeys.history(hour),
    queryFn: ({ signal }) =>
      api<MacrosFoodHistoryResponse>("/api/foods/history", {
        query: { at: hour ?? undefined, limit },
        signal,
      }).then((body) => body.items),
  });
}

export function useFoodDetail(id: string | undefined) {
  return useQuery({
    queryKey: foodKeys.detail(id ?? ""),
    queryFn: ({ signal }) =>
      api<MacrosFoodDetailResponse>(`/api/foods/${id}`, { signal }),
    enabled: Boolean(id),
    staleTime: 10 * 60_000,
  });
}

/** Resolves a scanned barcode; `null` when no food carries it. */
export async function lookupBarcode(
  barcode: string,
  signal?: AbortSignal,
): Promise<MacrosFoodDetailResponse | null> {
  try {
    return await api<MacrosFoodDetailResponse>(
      `/api/foods/barcode/${encodeURIComponent(barcode)}`,
      { signal },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function useCustomFoods() {
  return useQuery({
    queryKey: foodKeys.custom,
    queryFn: ({ signal }) =>
      api<MacrosUserCustomFoodsResponse>("/api/foods", { signal }).then(
        (body) => body.items,
      ),
  });
}

export function useCreateFood() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFoodInput) =>
      api<MacrosCreateFoodResponse>("/api/foods", {
        method: "POST",
        body: {
          ...input,
          clientMutationId: input.clientMutationId ?? newClientMutationId(),
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["foods"] }),
  });
}

export function useUpdateFood() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateFoodInput & { id: string }) =>
      api<MacrosFoodMutationResponse>(`/api/foods/${id}`, {
        method: "PATCH",
        body,
      }),
    // The log shows each entry's food with its current name and icon.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["foods"] }),
        queryClient.invalidateQueries({ queryKey: ["food-log"] }),
      ]),
  });
}

export function useDeleteFood() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MacrosDeleteFoodResponse>(`/api/foods/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["foods"] }),
  });
}

export function useFavorites() {
  return useQuery({
    queryKey: foodKeys.favorites,
    queryFn: ({ signal }) =>
      api<MacrosFavoritesResponse>("/api/foods/favorites", { signal }).then(
        (body) => body.items,
      ),
  });
}

export function useSaveFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FavoriteFoodInput) =>
      api<MacrosSaveFavoriteResponse>("/api/foods/favorites", {
        method: "POST",
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: foodKeys.favorites }),
  });
}

export function useRemoveFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (foodId: string) =>
      apiVoid("/api/foods/favorites", { method: "DELETE", body: { foodId } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: foodKeys.favorites }),
  });
}
