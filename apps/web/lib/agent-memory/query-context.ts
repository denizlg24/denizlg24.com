import type { AgentMemoryMode } from "@repo/schemas";
import { generateText } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { Conversation } from "@/models/Conversation";
import { getAgentMemorySettings } from "./settings";

export const SUMMARY_MAX_CHARS = 1_200;
const SUMMARY_INPUT_TURNS = 8;
const SUMMARY_INPUT_CHARS_PER_TURN = 1_500;

/**
 * Retrieval query for a chat turn. Short or anaphoric follow-ups ("yes, do
 * that one") carry almost no retrievable signal on their own, so the
 * conversation's rolling summary is prepended when one exists — the newest
 * message stays last so it dominates lexical matching.
 */
export function buildRetrievalQuery(options: {
  latestMessage: string;
  rollingSummary?: string | null;
}): string {
  const message = options.latestMessage.trim();
  const summary = options.rollingSummary?.trim();
  if (!message || !summary) return message;
  return `${summary.slice(0, SUMMARY_MAX_CHARS)}\n\n${message}`;
}

export interface SummaryTurn {
  role: "user" | "assistant";
  text: string;
}

function summarySystemPrompt(): string {
  return `You maintain a rolling summary of one conversation. The summary is used only as a search query to retrieve the owner's personal memories — it is never shown to anyone.
Merge the previous summary with the new turns. Keep the concrete topics, entities, people, projects, dates, and open questions being discussed; drop greetings, filler, and resolved tangents.
Reply with the summary text only — no preamble — in at most three sentences.`;
}

/**
 * Refresh the conversation's rolling retrieval summary with a cheap model.
 * No-op unless memory is enabled and `retrieval.querySummaryModel` is set.
 */
export async function updateConversationRetrievalSummary(options: {
  conversationId: string;
  memoryMode: AgentMemoryMode;
  previousSummary?: string | null;
  turns: SummaryTurn[];
}): Promise<{ updated: boolean }> {
  if (options.memoryMode !== "enabled") return { updated: false };
  const settings = await getAgentMemorySettings();
  const model = settings.retrieval.querySummaryModel;
  if (!model) return { updated: false };
  const turns = options.turns
    .filter((turn) => turn.text.trim().length > 0)
    .slice(-SUMMARY_INPUT_TURNS)
    .map((turn) => ({
      role: turn.role,
      text: turn.text.slice(0, SUMMARY_INPUT_CHARS_PER_TURN),
    }));
  if (turns.length === 0) return { updated: false };
  const generated = await generateText({
    purpose: "agent-memory-query-summary",
    source: "agent-memory-query-summary",
    model,
    system: summarySystemPrompt(),
    prompt: JSON.stringify({
      previousSummary:
        options.previousSummary?.slice(0, SUMMARY_MAX_CHARS) ?? null,
      turns,
    }),
    maxTokens: 300,
    temperature: 0,
  });
  const text = generated.text.trim().slice(0, SUMMARY_MAX_CHARS);
  if (!text) return { updated: false };
  await connectDB();
  await Conversation.updateOne(
    { _id: options.conversationId },
    { $set: { retrievalSummary: { text, updatedAt: new Date() } } },
  );
  return { updated: true };
}
