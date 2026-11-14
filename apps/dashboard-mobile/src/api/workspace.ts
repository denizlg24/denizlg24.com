import type {
  RecordsResponse,
  ViewConfig,
  ViewQueryResult,
  WorkspaceOpsRequest,
  WorkspacePageCreate,
  WorkspacePageDoc,
  WorkspacePageSummary,
  WorkspacePrefs,
} from "@repo/schemas";
import { RECORD_REFS_MAX } from "@repo/schemas";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isoDay } from "@/lib/format";

export function useWorkspaceRecords(refs: string[]) {
  return useQuery({
    queryKey: ["workspace", "records", refs],
    enabled: refs.length > 0,
    queryFn: async () => {
      const requests: Promise<RecordsResponse>[] = [];
      for (let index = 0; index < refs.length; index += RECORD_REFS_MAX) {
        requests.push(
          api.request<RecordsResponse>("workspace/records", {
            query: {
              refs: refs.slice(index, index + RECORD_REFS_MAX).join(","),
            },
          }),
        );
      }
      const results = await Promise.all(requests);
      return {
        records: results.flatMap((result) => result.records),
        missing: results.flatMap((result) => result.missing),
      };
    },
  });
}

export function useWorkspaceView(view: ViewConfig) {
  const today = isoDay(new Date());
  return useInfiniteQuery({
    queryKey: ["workspace", "view", view, today],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.request<ViewQueryResult>("workspace/views/query", {
        method: "POST",
        body: { view, today, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useWorkspacePrefs() {
  return useQuery({
    queryKey: ["workspace", "prefs"],
    queryFn: async () =>
      (await api.request<{ prefs: WorkspacePrefs }>("workspace/prefs")).prefs,
  });
}

export function useWorkspacePages() {
  return useQuery({
    queryKey: ["workspace", "pages"],
    queryFn: async () =>
      (await api.request<{ pages: WorkspacePageSummary[] }>("workspace/pages"))
        .pages,
  });
}

export function useWorkspacePage(id: string) {
  return useQuery({
    queryKey: ["workspace", "page", id],
    queryFn: async () =>
      (
        await api.request<{ page: WorkspacePageDoc }>(
          `workspace/pages/${encodeURIComponent(id)}`,
        )
      ).page,
  });
}

export function useCreateWorkspacePage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: WorkspacePageCreate) =>
      (
        await api.request<{ page: WorkspacePageDoc }>("workspace/pages", {
          method: "POST",
          body,
        })
      ).page,
    onSuccess: (page) => {
      client.setQueryData(["workspace", "page", page.id], page);
      void client.invalidateQueries({ queryKey: ["workspace", "pages"] });
    },
  });
}

/** Never replace a document from a stale phone snapshot: send small revision-aware operations. */
export function useWorkspaceOps(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: WorkspaceOpsRequest) =>
      (
        await api.request<{ page: WorkspacePageDoc }>(
          `workspace/pages/${encodeURIComponent(id)}/ops`,
          { method: "POST", body },
        )
      ).page,
    onSuccess: (page) => client.setQueryData(["workspace", "page", id], page),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["workspace", "page", id] });
      void client.invalidateQueries({ queryKey: ["workspace", "pages"] });
    },
  });
}
