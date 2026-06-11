import {
  Conversation,
  type IConversationMessage,
  type ILeanConversation,
} from "@/models/Conversation";
import { connectDB } from "./mongodb";

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
    messages: conversation.messages,
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
    { new: true },
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
    { new: true },
  ).lean();
  if (!conversation) return null;

  return { ...conversation, _id: conversation._id.toString() };
}

export async function deleteConversation(id: string): Promise<boolean> {
  await connectDB();

  const result = await Conversation.deleteOne({ _id: id });
  return result.deletedCount > 0;
}
