import type {
  AgentChatRequestInput,
  AgentConversationResponse,
  AgentUIMessage,
  ConversationListResponse,
  LlmModelsResponse,
} from "@repo/schemas";
import { pickDefaultModel } from "@repo/utils";
import {
  type AgentTurn,
  applyChunk,
  createEventParser,
  emptyTurn,
} from "@repo/utils/agent-stream";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { postStream } from "@/lib/stream";

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: () =>
      api.request<ConversationListResponse>("conversations", {
        query: { limit: 40 },
      }),
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: ["conversations", id],
    enabled: id !== undefined,
    queryFn: async () =>
      (await api.request<AgentConversationResponse>(`conversations/${id}`))
        .conversation,
  });
}

/** The model new conversations start on, as Voice picks it. */
export function useDefaultModel() {
  return useQuery({
    queryKey: ["llm", "default-model"],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { models } = await api.request<LlmModelsResponse>("llm/models");
      const model = pickDefaultModel(models, ["tool-use"]);
      if (!model) throw new Error("No model available");
      return model;
    },
  });
}

export async function createConversation(title: string, model: string) {
  const created = await api.request<{ conversation: { _id: string } }>(
    "conversations",
    {
      method: "POST",
      body: {
        title: title.length > 60 ? `${title.slice(0, 60)}…` : title,
        model,
        memoryMode: "enabled",
      },
    },
  );
  return created.conversation._id;
}

/**
 * One agent turn: a new user message, or the stored assistant message with
 * approval decisions. `onTurn` sees every intermediate state.
 */
export async function runTurn({
  conversationId,
  model,
  message,
  yolo,
  signal,
  onTurn,
}: {
  conversationId: string;
  model: string;
  message: AgentUIMessage;
  yolo: boolean;
  signal: AbortSignal;
  onTurn: (turn: AgentTurn) => void;
}): Promise<AgentTurn> {
  const body: AgentChatRequestInput = {
    conversationId,
    trigger: "submit-message",
    message,
    model,
    executionMode: yolo ? "yolo" : "interactive",
    pageTools: false,
  };
  const reader = await postStream("chat", body, signal);
  const decoder = new TextDecoder();
  const parse = createEventParser();
  let turn = emptyTurn();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const chunk of parse(decoder.decode(value, { stream: true }))) {
      turn = applyChunk(turn, chunk);
    }
    onTurn(turn);
  }
  return turn;
}
