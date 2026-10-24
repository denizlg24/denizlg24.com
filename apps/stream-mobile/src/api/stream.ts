import {
  assistantResultSchema,
  episodeSchema,
  gridMetaSchema,
  gridWindowSchema,
  homeSchema,
  type MemberSetup,
  mapHighlightsSchema,
  meSchema,
  type ProfileInput,
  playbackSchema,
  profileSchema,
  type progressInputSchema,
  progressSchema,
  type TitleSummary,
  titleDetailSchema,
  titlePageSchema,
  titleSummarySchema,
  tonightSchema,
  type viewingInputSchema,
} from "@repo/schemas/stream";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import { api, apiVoid } from "@/lib/api";
import { type TitleFilters, titleQueryParams } from "@/lib/title-query";

/**
 * TanStack Query over `/api/v1`. Every key starts with its domain so a write
 * invalidates by prefix; every body is parsed with `@repo/schemas/stream`.
 */

const titleResponseSchema = z.object({
  title: titleDetailSchema,
  inWatchlist: z.boolean(),
  progress: progressSchema.nullable(),
});
export type TitleResponse = z.infer<typeof titleResponseSchema>;

const episodesResponseSchema = z.object({ episodes: z.array(episodeSchema) });
const watchlistResponseSchema = z.object({
  titles: z.array(titleSummarySchema),
});

export const keys = {
  me: ["me"] as const,
  home: (profileId: string) => ["home", profileId] as const,
  titles: (params: Record<string, string>) => ["titles", params] as const,
  title: (id: string, profileId: string) => ["title", id, profileId] as const,
  episodes: (id: string, season: number) => ["episodes", id, season] as const,
  watchlist: (profileId: string) => ["watchlist", profileId] as const,
  playback: (id: string, profileId: string, episode: string | null) =>
    ["playback", id, profileId, episode] as const,
  tonight: (audience: string) => ["tonight", audience] as const,
  highlights: (audience: string) => ["grid", "highlights", audience] as const,
  assistant: (audience: string, prompt: string) =>
    ["assistant", audience, prompt] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: ({ signal }) => api("me", meSchema, { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useSetUpMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: MemberSetup) =>
      api("me", meSchema, { method: "POST", body: input }),
    onSuccess: (me) => client.setQueryData(keys.me, me),
  });
}

export function useSaveProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: ProfileInput }) =>
      id
        ? api(`profiles/${id}`, profileSchema, { method: "PATCH", body: input })
        : api("profiles", profileSchema, { method: "POST", body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useDeleteProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiVoid(`profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useHome(profileId: string) {
  return useQuery({
    queryKey: keys.home(profileId),
    queryFn: ({ signal }) =>
      api("home", homeSchema, { query: { profile: profileId }, signal }),
  });
}

export function useTitles(filters: TitleFilters) {
  const params = titleQueryParams(filters);
  return useInfiniteQuery({
    queryKey: keys.titles(params),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api("titles", titlePageSchema, {
        query: titleQueryParams(filters, pageParam),
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useTitle(id: string, profileId: string) {
  return useQuery({
    queryKey: keys.title(id, profileId),
    queryFn: ({ signal }) =>
      api(`titles/${id}`, titleResponseSchema, {
        query: { profile: profileId },
        signal,
      }),
  });
}

export function useEpisodes(id: string, season: number | null) {
  return useQuery({
    queryKey: keys.episodes(id, season ?? 0),
    enabled: season !== null,
    queryFn: ({ signal }) =>
      api(`titles/${id}/episodes`, episodesResponseSchema, {
        query: { season },
        signal,
      }),
    select: (data) => data.episodes,
    staleTime: 30 * 60_000,
  });
}

export function useWatchlist(profileId: string) {
  return useQuery({
    queryKey: keys.watchlist(profileId),
    queryFn: ({ signal }) =>
      api(`profiles/${profileId}/watchlist`, watchlistResponseSchema, {
        signal,
      }),
    select: (data) => data.titles,
  });
}

/** Optimistic on the title page and the list; rolled back if the server refuses. */
export function useToggleWatchlist(profileId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ title, add }: { title: TitleSummary; add: boolean }) =>
      apiVoid(`profiles/${profileId}/watchlist/${title.id}`, {
        method: add ? "PUT" : "DELETE",
      }),
    onMutate: async ({ title, add }) => {
      const titleKey = keys.title(title.id, profileId);
      const listKey = keys.watchlist(profileId);
      await Promise.all([
        client.cancelQueries({ queryKey: titleKey }),
        client.cancelQueries({ queryKey: listKey }),
      ]);
      const previousTitle = client.getQueryData<TitleResponse>(titleKey);
      const previousList =
        client.getQueryData<z.infer<typeof watchlistResponseSchema>>(listKey);
      if (previousTitle) {
        client.setQueryData<TitleResponse>(titleKey, {
          ...previousTitle,
          inWatchlist: add,
        });
      }
      if (previousList) {
        client.setQueryData(listKey, {
          titles: add
            ? [title, ...previousList.titles.filter((t) => t.id !== title.id)]
            : previousList.titles.filter((t) => t.id !== title.id),
        });
      }
      return { previousTitle, previousList, titleKey, listKey };
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      if (context.previousTitle) {
        client.setQueryData(context.titleKey, context.previousTitle);
      }
      if (context.previousList) {
        client.setQueryData(context.listKey, context.previousList);
      }
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.watchlist(profileId) }),
        client.invalidateQueries({ queryKey: ["title"] }),
        client.invalidateQueries({ queryKey: keys.home(profileId) }),
        client.invalidateQueries({ queryKey: ["grid", "highlights"] }),
      ]),
  });
}

export function useReportProgress(profileId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: z.input<typeof progressInputSchema>) =>
      api(`profiles/${profileId}/progress`, progressSchema, {
        method: "PUT",
        body: input,
      }),
    onSuccess: (progress) => {
      client.setQueriesData<TitleResponse>(
        { queryKey: ["title", progress.titleId, profileId] },
        (current) => (current ? { ...current, progress } : current),
      );
    },
  });
}

export function usePlayback(
  id: string,
  profileId: string,
  episode: string | null,
) {
  return useQuery({
    queryKey: keys.playback(id, profileId, episode),
    queryFn: ({ signal }) =>
      api(`titles/${id}/playback`, playbackSchema, {
        query: { profile: profileId, episode },
        signal,
      }),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useCurrentEpisode(id: string, episodeId: string | null) {
  return useQuery({
    queryKey: ["episodes", id, "current", episodeId],
    enabled: episodeId !== null,
    queryFn: ({ signal }) =>
      api(`titles/${id}/episodes`, episodesResponseSchema, { signal }),
    select: (data) =>
      data.episodes.find((episode) => episode.id === episodeId) ?? null,
    staleTime: 30 * 60_000,
  });
}

export function useRecordProgress(profileIds: string[]) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: z.input<typeof progressInputSchema>) =>
      Promise.all(
        profileIds.map((profileId) =>
          api(`profiles/${profileId}/progress`, progressSchema, {
            method: "PUT",
            body: input,
          }),
        ),
      ),
    onSuccess: (saved) => {
      for (let index = 0; index < profileIds.length; index++) {
        client.setQueriesData<TitleResponse>(
          { queryKey: ["title", saved[index]!.titleId, profileIds[index]] },
          (current) =>
            current ? { ...current, progress: saved[index]! } : current,
        );
      }
    },
  });
}

export function useRecordViewing(profileIds: string[]) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: z.input<typeof viewingInputSchema>) =>
      Promise.all(
        profileIds.map((profileId) =>
          api(`profiles/${profileId}/viewing`, progressSchema, {
            method: "PUT",
            body: input,
          }),
        ),
      ),
    onSuccess: () => {
      for (const id of profileIds) invalidateAfterWatching(client, id);
    },
  });
}

/** After the player closes, the rails and the detail page should show where it stopped. */
export function invalidateAfterWatching(
  client: ReturnType<typeof useQueryClient>,
  profileId: string,
) {
  void client.invalidateQueries({ queryKey: keys.home(profileId) });
  void client.invalidateQueries({ queryKey: ["title"] });
  void client.invalidateQueries({ queryKey: ["tonight"] });
  void client.invalidateQueries({ queryKey: ["grid", "highlights"] });
}

/** Studio's daily edition for whoever is on the sofa (`a,b`). */
export function useTonight(audience: string) {
  return useQuery({
    queryKey: keys.tonight(audience),
    queryFn: ({ signal }) =>
      api("tonight", tonightSchema, { query: { profiles: audience }, signal }),
    staleTime: 10 * 60_000,
  });
}

/** Picks for a typed wish; the model can take 5–20 s, so an answer is kept a while. */
export function useAssistant(audience: string, prompt: string) {
  return useQuery({
    queryKey: keys.assistant(audience, prompt),
    enabled: prompt.length > 0,
    queryFn: ({ signal }) =>
      api("assistant", assistantResultSchema, {
        query: { profiles: audience, q: prompt },
        signal,
      }),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useGridMeta(audience: string, type: string | null) {
  return useQuery({
    queryKey: ["grid", "meta", audience, type],
    queryFn: ({ signal }) =>
      api("grid/meta", gridMetaSchema, {
        query: { profiles: audience, type },
        signal,
      }),
    staleTime: 30 * 60_000,
  });
}

export function useGridBlocks(
  audience: string,
  type: string | null,
  blocks: { x0: number; y0: number; x1: number; y1: number }[],
) {
  return useQueries({
    queries: blocks.map((block) => ({
      queryKey: ["grid", "block", audience, type, block],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api("grid", gridWindowSchema, {
          query: { profiles: audience, type, ...block },
          signal,
        }),
      staleTime: 30 * 60_000,
      gcTime: 10 * 60_000,
    })),
  });
}

export function useHighlights(audience: string) {
  return useQuery({
    queryKey: keys.highlights(audience),
    queryFn: ({ signal }) =>
      api("grid/highlights", mapHighlightsSchema, {
        query: { profiles: audience },
        signal,
      }),
    select: (data) => data.highlights,
  });
}

export function useActorTitles(name: string, profileId: string) {
  return useInfiniteQuery({
    queryKey: ["actor", name, profileId],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api("titles", titlePageSchema, {
        query: {
          actor: name,
          profile: profileId,
          sort: "newest",
          limit: 30,
          cursor: pageParam,
        },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
