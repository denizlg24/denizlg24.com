import { randomUUID } from "node:crypto";
import {
  type AgentUIMessage,
  type AgentUIMessagePart,
  appendLatexAgentMessagesSchema,
  LATEX_PROPOSE_TOOL,
  type LatexAgentProposalOutput,
  latexAgentStreamRequestSchema,
  updateLatexAgentChangeSchema,
} from "@repo/schemas";
import { createUIMessageStreamResponse } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { AgentMergeError } from "@/lib/agent/merge";
import { getConversation, saveConversationMessages } from "@/lib/conversations";
import { markProposal } from "@/lib/latex-agent/proposals";
import { agentConversationResponse } from "@/lib/latex-agent/response";
import {
  ensureProjectConversation,
  startLatexAgentTurn,
} from "@/lib/latex-agent/turn";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import {
  getLatexProject,
  LatexProjectRevisionConflictError,
} from "@/lib/latex-projects";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: Params) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const project = await getLatexProject((await context.params).projectId);
    const conversation = project.conversationId
      ? await getConversation(project.conversationId)
      : null;
    return agentConversationResponse(project, conversation);
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to load LaTeX agent conversation", error);
    return NextResponse.json(
      { error: "Failed to load project agent" },
      { status: 500 },
    );
  }
}

/** One streamed agent turn over the project. */
export async function POST(request: NextRequest, context: Params) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = latexAgentStreamRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid agent request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { stream } = await startLatexAgentTurn({
      projectId: (await context.params).projectId,
      body: parsed.data,
      abortSignal: request.signal,
    });
    return createUIMessageStreamResponse({ stream });
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

/** A turn produced by a local model in the editor, recorded as-is. */
export async function PUT(request: NextRequest, context: Params) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = appendLatexAgentMessagesSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid local agent response", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const projectId = (await context.params).projectId;
    let project = await getLatexProject(projectId);
    if (project.revision !== parsed.data.baseRevision) {
      throw new LatexProjectRevisionConflictError(project);
    }
    const ensured = await ensureProjectConversation({
      projectId,
      project,
      model: `ollama/${parsed.data.model}`,
      memoryMode: parsed.data.memoryMode,
    });
    project = ensured.project;
    const conversation = await getConversation(ensured.conversationId);
    if (!conversation) throw new Error("Agent conversation was not found");

    const now = new Date().toISOString();
    const userParts: AgentUIMessagePart[] = [
      ...(parsed.data.attachments ?? []).map(
        (attachment): AgentUIMessagePart => ({
          type: "file",
          mediaType: attachment.type === "image" ? "image" : "application/pdf",
          url: attachment.url,
          filename: attachment.name,
        }),
      ),
      { type: "text", text: parsed.data.message },
    ];
    const assistantParts: AgentUIMessagePart[] = [
      { type: "step-start" },
      { type: "text", text: parsed.data.response, state: "done" },
      ...parsed.data.editProposals.map((proposal): AgentUIMessagePart => {
        const output: LatexAgentProposalOutput = {
          proposal,
          status: "proposed",
        };
        return {
          type: "dynamic-tool",
          toolName: LATEX_PROPOSE_TOOL,
          toolCallId: proposal.id,
          state: "output-available",
          input: { operation: proposal.kind, filePath: proposal.filePath },
          output,
        };
      }),
    ];
    const messages: AgentUIMessage[] = [
      ...conversation.messages,
      {
        id: randomUUID(),
        role: "user",
        parts: userParts,
        metadata: { createdAt: now },
      },
      {
        id: randomUUID(),
        role: "assistant",
        parts: assistantParts,
        metadata: { createdAt: now, model: `ollama/${parsed.data.model}` },
      },
    ];
    await saveConversationMessages(ensured.conversationId, messages, {
      llmModel: `ollama/${parsed.data.model}`,
    });
    project = await getLatexProject(projectId);
    return agentConversationResponse(
      project,
      await getConversation(ensured.conversationId),
    );
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to persist local LaTeX agent response", error);
    return NextResponse.json(
      { error: "The local agent response could not be saved" },
      { status: 503 },
    );
  }
}

/** Records the user's decision on one proposal. */
export async function PATCH(request: NextRequest, context: Params) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = updateLatexAgentChangeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid project change status",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const project = await getLatexProject((await context.params).projectId);
    const conversation = project.conversationId
      ? await getConversation(project.conversationId)
      : null;
    if (!conversation) {
      return NextResponse.json(
        { error: "Agent conversation not found" },
        { status: 404 },
      );
    }
    const next = markProposal(
      conversation.messages,
      parsed.data.proposalId,
      parsed.data.status,
    );
    if (!next) {
      return NextResponse.json(
        { error: "Project change not found" },
        { status: 404 },
      );
    }
    await saveConversationMessages(conversation._id, next);
    return agentConversationResponse(
      project,
      await getConversation(conversation._id),
    );
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("Failed to update LaTeX agent change status", error);
    return NextResponse.json(
      { error: "The project change status could not be saved" },
      { status: 503 },
    );
  }
}
