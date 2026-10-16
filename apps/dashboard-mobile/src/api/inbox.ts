import type {
  CommentListResponse,
  ContactListResponse,
  EmailAccountsResponse,
  EmailDetailResponse,
  EmailListResponse,
  EmailSendInput,
  IContact,
  TriageDetailResponse,
  TriageListResponse,
  TriageSuggestionType,
} from "@repo/schemas";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { todayKey } from "./today";

const PAGE = 40;

export function useEmailAccounts() {
  return useQuery({
    queryKey: ["email-accounts"],
    queryFn: async () =>
      (await api.request<EmailAccountsResponse>("email-accounts")).accounts,
    staleTime: 5 * 60_000,
  });
}

export function useEmails(accountId: string | undefined, search: string) {
  return useInfiniteQuery({
    queryKey: ["emails", accountId, search],
    enabled: accountId !== undefined,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.request<EmailListResponse>(`email-accounts/${accountId}/emails`, {
        query: { page: pageParam, limit: PAGE, search: search || undefined },
      }),
    getNextPageParam: (last) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
  });
}

export function useSyncAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      api.request(`email-accounts/${accountId}/sync`, { method: "POST" }),
    onSettled: (_data, _error, accountId) => {
      void client.invalidateQueries({ queryKey: ["emails", accountId] });
      void client.invalidateQueries({ queryKey: todayKey });
    },
  });
}

export function useEmail(accountId: string, emailId: string) {
  return useQuery({
    queryKey: ["email", emailId],
    enabled: emailId.length > 0,
    queryFn: async () =>
      (
        await api.request<EmailDetailResponse>(
          `email-accounts/${accountId}/emails/${emailId}`,
        )
      ).email,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSendEmail(accountId: string) {
  return useMutation({
    mutationFn: (input: EmailSendInput) =>
      api.request(`email-accounts/${accountId}/send`, {
        method: "POST",
        body: input,
      }),
  });
}

export const triageQueueKey = ["triage", "pending"] as const;

/** Rows with a suggestion still waiting on a yes or no. */
export function useTriageQueue() {
  return useQuery({
    queryKey: triageQueueKey,
    queryFn: () =>
      api.request<TriageListResponse>("triage", {
        query: { suggestions: "pending", category: "all", limit: 50 },
      }),
  });
}

export function useTriage(id: string) {
  return useQuery({
    queryKey: ["triage", id],
    queryFn: () => api.request<TriageDetailResponse>(`triage/${id}`),
  });
}

export interface SuggestionDecision {
  triageId: string;
  suggestionId: string;
  type: TriageSuggestionType;
  action: "accept" | "dismiss";
}

export function useDecideSuggestion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      triageId,
      suggestionId,
      type,
      action,
    }: SuggestionDecision) =>
      api.request(`triage/${triageId}/suggestions/${suggestionId}`, {
        method: "PATCH",
        body: { type, action },
      }),
    onMutate: async (decision) => {
      await client.cancelQueries({ queryKey: triageQueueKey });
      const previous = client.getQueryData<TriageListResponse>(triageQueueKey);
      if (previous) {
        client.setQueryData(
          triageQueueKey,
          withoutSuggestion(previous, decision),
        );
      }
      return { previous };
    },
    onError: (_error, _decision, context) => {
      if (context?.previous) {
        client.setQueryData(triageQueueKey, context.previous);
      }
    },
    onSettled: (_data, _error, decision) => {
      void client.invalidateQueries({ queryKey: ["triage"] });
      void client.invalidateQueries({
        queryKey: ["triage", decision.triageId],
      });
      void client.invalidateQueries({ queryKey: todayKey });
    },
  });
}

function withoutSuggestion(
  list: TriageListResponse,
  { triageId, suggestionId, action }: SuggestionDecision,
): TriageListResponse {
  const status = action === "accept" ? "accepted" : "dismissed";
  return {
    ...list,
    items: list.items.map((item) =>
      item._id !== triageId
        ? item
        : {
            ...item,
            suggestedTasks: item.suggestedTasks.map((entry) =>
              entry._id === suggestionId ? { ...entry, status } : entry,
            ),
            suggestedEvents: item.suggestedEvents.map((entry) =>
              entry._id === suggestionId ? { ...entry, status } : entry,
            ),
            suggestedActions: item.suggestedActions.map((entry) =>
              entry._id === suggestionId ? { ...entry, status } : entry,
            ),
          },
    ),
  };
}

export function useArchiveTriage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.request(`triage/${id}`, {
        method: "PATCH",
        body: { userStatus: "archived" },
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["triage"] });
      void client.invalidateQueries({ queryKey: todayKey });
    },
  });
}

export function useContacts() {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: () => api.request<ContactListResponse>("contacts"),
  });
}

export function useUpdateContact() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      status,
    }: {
      ticketId: string;
      status: IContact["status"];
    }) =>
      api.request(`contacts/${ticketId}`, {
        method: "PATCH",
        body: { status },
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["contacts"] });
      void client.invalidateQueries({ queryKey: todayKey });
    },
  });
}

export function useReplyContact() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      message,
    }: {
      ticketId: string;
      message: string;
    }) =>
      api.request(`contacts/${ticketId}/reply`, {
        method: "POST",
        body: { message },
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["contacts"] });
      void client.invalidateQueries({ queryKey: todayKey });
    },
  });
}

export function useComments() {
  return useQuery({
    queryKey: ["comments"],
    queryFn: () => api.request<CommentListResponse>("comments"),
  });
}

export function useModerateComment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "approve" | "reject";
    }) => api.request(`comments/${id}`, { method: "PATCH", body: { action } }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["comments"] });
      void client.invalidateQueries({ queryKey: todayKey });
    },
  });
}
