import type { AgentMemoryMode } from "@repo/schemas";
import mongoose from "mongoose";

export interface StoredContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  source?: Record<string, unknown>;
  is_error?: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface IConversationMessage {
  eventId: string;
  role: "user" | "assistant";
  content: string | StoredContentBlock[];
  tokenUsage?: TokenUsage;
  retrievalTraceId?: string;
  memoryInjected?: boolean;
  pendingActions?: {
    toolId: string;
    toolName: string;
    input: Record<string, unknown>;
    status: "pending";
  }[];
  createdAt: Date;
}

export interface IConversationRetrievalSummary {
  text: string;
  updatedAt: Date;
}

/**
 * `ui` rows store AI SDK UI messages. A row without it predates the AI SDK
 * loop and stores Anthropic-shaped `IConversationMessage`s; those are
 * converted on read and rewritten as `ui` on the next save.
 */
export type ConversationFormat = "ui";

export interface IConversation extends mongoose.Document {
  title: string;
  llmModel: string;
  memoryMode: AgentMemoryMode;
  format?: ConversationFormat;
  messages: unknown[];
  /** Rolling topic summary maintained by the query-summary model; used only
   *  as memory-retrieval query context, never shown to the chat model. */
  retrievalSummary?: IConversationRetrievalSummary;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanConversation {
  _id: string;
  title: string;
  llmModel: string;
  memoryMode: AgentMemoryMode;
  format?: ConversationFormat;
  messages: unknown[];
  retrievalSummary?: IConversationRetrievalSummary;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new mongoose.Schema<IConversation>(
  {
    title: { type: String, required: true },
    llmModel: { type: String, required: true },
    format: { type: String, enum: ["ui"] },
    messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
    memoryMode: {
      type: String,
      enum: ["enabled", "retrieval-off", "incognito"],
      default: "enabled",
      required: true,
    },
    retrievalSummary: {
      type: {
        text: { type: String, required: true, maxlength: 2_000 },
        updatedAt: { type: Date, required: true },
      },
      default: undefined,
    },
  },
  { timestamps: true, minimize: false },
);

ConversationSchema.index({ updatedAt: -1, _id: -1 });

export const Conversation: mongoose.Model<IConversation> =
  mongoose.models.Conversation ||
  mongoose.model<IConversation>("Conversation", ConversationSchema);
