import { randomUUID } from "node:crypto";
import {
  type AgentUIMessagePart,
  sendLatexAgentMessageSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { AgentMergeError } from "@/lib/agent/merge";
import { getConversation } from "@/lib/conversations";
import { agentConversationResponse } from "@/lib/latex-agent/response";
import { drainTurn, startLatexAgentTurn } from "@/lib/latex-agent/turn";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { getLatexProject } from "@/lib/latex-projects";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The same turn as the streaming route, for callers that cannot read a UI
 * message stream (the MCP server): plain text in, the updated conversation
 * and pending proposals out once the turn has finished.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = sendLatexAgentMessageSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid agent message", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { message, attachments, ...rest } = parsed.data;
  const parts: AgentUIMessagePart[] = [
    ...(attachments ?? []).map(
      (attachment): AgentUIMessagePart => ({
        type: "file",
        mediaType: attachment.type === "image" ? "image" : "application/pdf",
        url: attachment.url,
        filename: attachment.name,
      }),
    ),
    { type: "text", text: message },
  ];

  try {
    const projectId = (await context.params).projectId;
    const turn = await startLatexAgentTurn({
      projectId,
      abortSignal: request.signal,
      body: {
        ...rest,
        trigger: "submit-message",
        message: { id: randomUUID(), role: "user", parts },
        tools: { webSearch: false, webFetch: false, thinkLonger: false },
        connectors: [],
        executionMode: "interactive",
      },
    });
    await drainTurn(turn.stream);
    return agentConversationResponse(
      await getLatexProject(projectId),
      await getConversation(turn.conversationId),
    );
  } catch (error) {
    if (error instanceof AgentMergeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("LaTeX project agent failed", error);
    return NextResponse.json(
      { error: "The project agent is unavailable" },
      { status: 503 },
    );
  }
}
