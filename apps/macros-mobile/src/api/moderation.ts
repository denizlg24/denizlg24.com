import type {
  MacrosBlockContributorResponse,
  MacrosBlockedContributorsResponse,
  MacrosFoodSharing,
  MacrosReportFoodBody,
  MacrosReportFoodResponse,
} from "@repo/schemas/macros";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiVoid } from "@/lib/api";

export const moderationKeys = {
  sharing: (id: string) => ["moderation", "sharing", id] as const,
  blocks: ["moderation", "blocks"] as const,
};

/** Whether a catalogue food can be reported or its contributor hidden. */
export function useFoodSharing(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: moderationKeys.sharing(id ?? ""),
    queryFn: ({ signal }) =>
      api<MacrosFoodSharing>(`/api/foods/${id}/sharing`, { signal }),
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
  });
}

/** Reported and hidden foods leave search and history straight away. */
function invalidateAfterModeration(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["foods"] }),
    queryClient.invalidateQueries({ queryKey: ["moderation"] }),
  ]);
}

export function useReportFood() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: MacrosReportFoodBody & { id: string }) =>
      api<MacrosReportFoodResponse>(`/api/foods/${id}/report`, {
        method: "POST",
        body,
      }),
    onSuccess: () => invalidateAfterModeration(queryClient),
  });
}

export function useHideContributor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MacrosBlockContributorResponse>(`/api/foods/${id}/hide-contributor`, {
        method: "POST",
      }),
    onSuccess: () => invalidateAfterModeration(queryClient),
  });
}

export function useHiddenContributors() {
  return useQuery({
    queryKey: moderationKeys.blocks,
    queryFn: ({ signal }) =>
      api<MacrosBlockedContributorsResponse>("/api/moderation/blocks", {
        signal,
      }).then((body) => body.blocks),
  });
}

export function useUnhideContributor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blockId: string) =>
      apiVoid(`/api/moderation/blocks/${blockId}`, { method: "DELETE" }),
    onSuccess: () => invalidateAfterModeration(queryClient),
  });
}
