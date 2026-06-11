import mongoose from "mongoose";

export interface StoredContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface IConversationMessage {
  role: "user" | "assistant";
  content: string | StoredContentBlock[];
  tokenUsage?: TokenUsage;
  createdAt: Date;
}

export interface IConversation extends mongoose.Document {
  title: string;
  llmModel: string;
  messages: IConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanConversation {
  _id: string;
  title: string;
  llmModel: string;
  messages: IConversationMessage[];
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
          content: { type: mongoose.Schema.Types.Mixed, required: true },
          tokenUsage: {
            inputTokens: Number,
            outputTokens: Number,
            costUsd: Number,
          },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true, minimize: false },
);

export const Conversation: mongoose.Model<IConversation> =
  mongoose.models.Conversation ||
  mongoose.model<IConversation>("Conversation", ConversationSchema);
