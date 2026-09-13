import {
  type ILatexProjectRecord,
  latexAgentConversationResponseSchema,
} from "@repo/schemas";
import { NextResponse } from "next/server";
import type { StoredConversation } from "@/lib/conversations";
import { pendingProposals } from "./proposals";

export function agentConversationResponse(
  project: ILatexProjectRecord,
  conversation: StoredConversation | null,
) {
  return NextResponse.json(
    latexAgentConversationResponseSchema.parse({
      project,
      conversationId: conversation?._id ?? null,
      messages: conversation?.messages ?? [],
      editProposals: conversation
        ? pendingProposals(conversation.messages)
        : [],
    }),
  );
}
