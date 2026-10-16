import type {
  AgentMemory,
  AgentMemoryListResponse,
  AgentTaskOverview,
  AgentTaskRun,
  AuthenticatorAccountsResponse,
  AuthenticatorCodesResponse,
  NoteResponse,
  NoteSummaryListResponse,
  ResourcesResponse,
  SubResourcesResponse,
} from "@repo/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useMemoryReview() {
  return useQuery({
    queryKey: ["memory", "candidates"],
    queryFn: () =>
      api.request<AgentMemoryListResponse>("agent-memory", {
        query: {
          candidateStatus: "pending",
          candidateSort: "confidence",
          limit: 40,
        },
      }),
  });
}

export function useMemory(id: string) {
  return useQuery({
    queryKey: ["memory", id],
    queryFn: async () =>
      (
        await api.request<{ memory: AgentMemory }>(
          `agent-memory/memories/${id}`,
        )
      ).memory,
  });
}

export function useDecideCandidate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "accept" | "dismiss";
    }) =>
      api.request(`agent-memory/candidates/${id}`, {
        method: "POST",
        body: { action },
      }),
    onMutate: async ({ id }) => {
      await client.cancelQueries({ queryKey: ["memory", "candidates"] });
      const previous = client.getQueryData<AgentMemoryListResponse>([
        "memory",
        "candidates",
      ]);
      if (previous) {
        client.setQueryData<AgentMemoryListResponse>(["memory", "candidates"], {
          ...previous,
          candidates: previous.candidates.filter((item) => item.id !== id),
          pendingCandidates: Math.max(0, previous.pendingCandidates - 1),
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        client.setQueryData(["memory", "candidates"], context.previous);
      }
    },
    onSettled: () =>
      void client.invalidateQueries({ queryKey: ["memory", "candidates"] }),
  });
}

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: () => api.request<AgentTaskOverview>("agent-tasks"),
  });
}

/** Polled while the run is live: the transcript grows on every read. */
export function useTaskRun(id: string) {
  return useQuery({
    queryKey: ["tasks", "run", id],
    queryFn: async () =>
      (await api.request<{ run: AgentTaskRun }>(`agent-tasks/runs/${id}`)).run,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 2_000 : false;
    },
  });
}

export function useRunTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      api.request<{ run: AgentTaskRun }>(`agent-tasks/${taskId}/run`, {
        method: "POST",
      }),
    onSettled: () => void client.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useSetTaskStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      status,
    }: {
      taskId: string;
      status: "active" | "paused";
    }) =>
      api.request(`agent-tasks/${taskId}`, {
        method: "PATCH",
        body: { status },
      }),
    onSettled: () => void client.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useNotes(search: string) {
  return useQuery({
    queryKey: ["notes", search],
    queryFn: async () =>
      (
        await api.request<NoteSummaryListResponse>(
          search ? "notes/search" : "notes",
          {
            query: search
              ? { q: search, limit: 30 }
              : { summary: 1, limit: 60 },
          },
        )
      ).notes,
  });
}

export function useNote(id: string) {
  return useQuery({
    queryKey: ["notes", "one", id],
    queryFn: async () => (await api.request<NoteResponse>(`notes/${id}`)).note,
  });
}

export function useCreateNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      content: string;
      url?: string;
    }) => {
      const { note } = await api.request<NoteResponse>("notes", {
        method: "POST",
        body: input,
      });
      // Tags and groups are recomputed on every new note; a failure here
      // leaves a note without tags, not a lost note.
      await api
        .request(`notes/${note._id}/categorize`, { method: "POST", body: {} })
        .catch(() => undefined);
      return note;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: ["notes"] }),
  });
}

export function useResources() {
  return useQuery({
    queryKey: ["resources"],
    queryFn: async () =>
      (await api.request<ResourcesResponse>("resources")).resources,
  });
}

export function useSubResources(resourceId: string) {
  return useQuery({
    queryKey: ["resources", resourceId, "subs"],
    queryFn: async () =>
      (
        await api.request<SubResourcesResponse>(
          `resources/${resourceId}/sub-resources`,
        )
      ).subResources,
  });
}

export function useAuthenticatorAccounts() {
  return useQuery({
    queryKey: ["authenticator", "accounts"],
    staleTime: 10 * 60_000,
    queryFn: async () =>
      (await api.request<AuthenticatorAccountsResponse>("authenticator"))
        .accounts,
  });
}

/** Never `/authenticator/export`: the phone shows codes, it holds no secret. */
export function useAuthenticatorCodes() {
  return useQuery({
    queryKey: ["authenticator", "codes"],
    queryFn: async () =>
      (await api.request<AuthenticatorCodesResponse>("authenticator/codes"))
        .codes,
    refetchInterval: (query) => {
      const codes = query.state.data;
      if (!codes || codes.length === 0) return 30_000;
      const soonest = Math.min(...codes.map((code) => code.remaining));
      return Math.max(1, soonest) * 1_000 + 250;
    },
  });
}
