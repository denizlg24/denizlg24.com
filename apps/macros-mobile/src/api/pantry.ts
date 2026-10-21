import type {
  MacrosPantryResponse,
  MacrosSetPantryItemBody,
} from "@repo/schemas/macros";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiVoid } from "@/lib/api";

export const pantryKey = ["pantry"] as const;
export function usePantry() {
  return useQuery({
    queryKey: pantryKey,
    queryFn: ({ signal }) =>
      api<MacrosPantryResponse>("/api/pantry", { signal }),
  });
}
export function useSetPantryItem() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["pantry", "set"],
    networkMode: "always",
    retry: false,
    mutationFn: (body: MacrosSetPantryItemBody) =>
      api<MacrosPantryResponse>("/api/pantry", { method: "PUT", body }),
    onSuccess: (data) => {
      client.setQueryData(pantryKey, data);
      void client.invalidateQueries({ queryKey: ["foods", "search"] });
    },
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
        client.invalidateQueries({ queryKey: ["foods", "search"] }),
      ]),
  });
}
