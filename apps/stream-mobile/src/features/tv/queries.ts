import {
  progressSchema,
  titleDetailSchema,
  titlePageSchema,
} from "@repo/schemas/stream";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { keys } from "@/api/stream";
import { api } from "@/lib/api";

const titleResponseSchema = z.object({
  title: titleDetailSchema,
  inWatchlist: z.boolean(),
  progress: progressSchema.nullable(),
});

/**
 * `GET /titles/:id` under the same key as `useTitle`, but idle until there
 * is an id: the billboard asks for whatever the remote settles on.
 */
export function useTitleDetail(id: string | null, profileId: string) {
  return useQuery({
    queryKey: keys.title(id ?? "", profileId),
    enabled: id !== null,
    queryFn: ({ signal }) =>
      api(`titles/${id}`, titleResponseSchema, {
        query: { profile: profileId },
        signal,
      }),
    staleTime: 5 * 60_000,
  });
}

/** A collection: every title matching `/titles` params, a page at a time. */
export function useCollection(params: Record<string, string>) {
  return useInfiniteQuery({
    queryKey: ["tv-collection", params],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api("titles", titlePageSchema, {
        query: { ...params, cursor: pageParam, limit: 42 },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
