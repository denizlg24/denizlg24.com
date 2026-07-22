import { randomUUID } from "node:crypto";
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

export interface IConversation extends mongoose.Document {
  title: string;
  llmModel: string;
  memoryMode: AgentMemoryMode;
  messages: IConversationMessage[];
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
  messages: IConversationMessage[];
  retrievalSummary?: IConversationRetrievalSummary;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new mongoose.Schema<IConversation>(
  {
    title: { type: String, required: true },
    llmModel: { type: String, required: true },
    messages: {
      type: [
        {
          role: {
            type: String,
            enum: ["user", "assistant"],
            required: true,
          },
          eventId: { type: String, default: randomUUID, required: true },
          content: { type: mongoose.Schema.Types.Mixed, required: true },
          tokenUsage: {
            inputTokens: Number,
            outputTokens: Number,
            costUsd: Number,
          },
          retrievalTraceId: { type: String },
          memoryInjected: { type: Boolean },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
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
