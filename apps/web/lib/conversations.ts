import {
  Conversation,
  type IConversationMessage,
  type ILeanConversation,
  type StoredContentBlock,
} from "@/models/Conversation";
import { connectDB } from "./mongodb";
import { isClientTool, isWriteTool } from "./tools/registry";

function isToolResultBlock(
  block: StoredContentBlock,
): block is StoredContentBlock & { tool_use_id: string } {
  return block.type === "tool_result" && typeof block.tool_use_id === "string";
}

function isToolUseBlock(
  block: StoredContentBlock,
): block is StoredContentBlock & {
  id: string;
  name: string;
  input: Record<string, unknown>;
} {
  return (
    block.type === "tool_use" &&
    typeof block.id === "string" &&
    typeof block.name === "string"
  );
}

function withPendingActions(
  messages: ILeanConversation["messages"],
): ILeanConversation["messages"] {
  const resolvedToolUseIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (isToolResultBlock(block)) resolvedToolUseIds.add(block.tool_use_id);
    }
  }

  return messages.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return message;
    }

    const pendingActions: NonNullable<IConversationMessage["pendingActions"]> =
      [];
    for (const block of message.content) {
      if (
        !isToolUseBlock(block) ||
        resolvedToolUseIds.has(block.id) ||
        isClientTool(block.name) ||
        !isWriteTool(block.name)
      ) {
        continue;
      }

      pendingActions.push({
        toolId: block.id,
        toolName: block.name,
        input:
          typeof block.input === "object" &&
          block.input !== null &&
          !Array.isArray(block.input)
            ? block.input
            : {},
        status: "pending",
      });
    }

    return pendingActions.length > 0 ? { ...message, pendingActions } : message;
  });
}

export async function getAllConversations() {
  await connectDB();

  const conversations = await Conversation.find()
    .select("title llmModel updatedAt")
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();

  return conversations.map((c) => ({
    _id: c._id.toString(),
    title: c.title,
    llmModel: c.llmModel,
    updatedAt: c.updatedAt,
  }));
}

export async function getConversation(id: string) {
  await connectDB();

  const conversation = await Conversation.findById(id).lean();
  if (!conversation) return null;

  return {
    _id: conversation._id.toString(),
    title: conversation.title,
    llmModel: conversation.llmModel,
    messages: withPendingActions(conversation.messages),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export async function createConversation(data: {
  title: string;
  llmModel: string;
}) {
  await connectDB();

  const conversation = await Conversation.create({
    title: data.title,
    llmModel: data.llmModel,
    messages: [],
  });

  return { ...conversation, _id: conversation._id.toString() };
}

export async function updateConversationMessages(
  id: string,
  messages: ILeanConversation["messages"],
) {
  await connectDB();

  const conversation = await Conversation.findByIdAndUpdate(
    id,
    { messages, updatedAt: new Date() },
    { returnDocument: "after" },
  ).lean();
  if (!conversation) return null;

  return { ...conversation, _id: conversation._id.toString() };
}

export async function appendMessages(
  id: string,
  messages: IConversationMessage[],
) {
  await connectDB();

  const conversation = await Conversation.findByIdAndUpdate(
    id,
    {
      $push: { messages: { $each: messages } },
      updatedAt: new Date(),
    },
    { returnDocument: "after" },
  ).lean();
  if (!conversation) return null;

  return { ...conversation, _id: conversation._id.toString() };
}

export async function deleteConversation(id: string): Promise<boolean> {
  await connectDB();

  const result = await Conversation.deleteOne({ _id: id });
  return result.deletedCount > 0;
}
