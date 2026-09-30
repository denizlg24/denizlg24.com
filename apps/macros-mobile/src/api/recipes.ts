import type {
  MacrosCreateRecipeResponse,
  MacrosOkResponse,
  MacrosRecipeDetailResponse,
  MacrosRecipesResponse,
  MacrosUpdateRecipeResponse,
  macrosCreateRecipeBodySchema,
  macrosUpdateRecipeBodySchema,
} from "@repo/schemas/macros";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { api } from "@/lib/api";
import { queryKeys } from "./keys";

export type CreateRecipeInput = z.input<typeof macrosCreateRecipeBodySchema>;
export type UpdateRecipeInput = z.input<typeof macrosUpdateRecipeBodySchema>;

export const recipeKeys = {
  list: [...queryKeys.recipes, "list"] as const,
  detail: (id: string) => [...queryKeys.recipes, "detail", id] as const,
};

export function useRecipes() {
  return useQuery({
    queryKey: recipeKeys.list,
    queryFn: ({ signal }) =>
      api<MacrosRecipesResponse>("/api/recipes", { signal }).then(
        (body) => body.items,
      ),
  });
}

export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: recipeKeys.detail(id ?? ""),
    queryFn: ({ signal }) =>
      api<MacrosRecipeDetailResponse>(`/api/recipes/${id}`, { signal }).then(
        (body) => body.recipe,
      ),
    enabled: Boolean(id),
  });
}

export function useCreateRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    // Creates rows: a retry after a lost response would create them twice.
    retry: false,
    mutationFn: (body: CreateRecipeInput) =>
      api<MacrosCreateRecipeResponse>("/api/recipes", {
        method: "POST",
        body,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.recipes }),
  });
}

/** A changed ingredient list, serving count or label mints a new nutrition snapshot. */
export function useUpdateRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateRecipeInput & { id: string }) =>
      api<MacrosUpdateRecipeResponse>(`/api/recipes/${id}`, {
        method: "PATCH",
        body,
      }),
    // Logged servings show the recipe's current name and icon.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recipes }),
        queryClient.invalidateQueries({ queryKey: queryKeys.foodLog }),
      ]),
  });
}

export function useDeleteRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MacrosOkResponse>(`/api/recipes/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.recipes }),
  });
}
