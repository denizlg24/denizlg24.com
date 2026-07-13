import { agentMemoryDecisionSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  acceptMemoryCandidate,
  dismissMemoryCandidate,
} from "@/lib/agent-memory/governance";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import {
  serializeAgentMemory,
  serializeAgentMemoryCandidate,
} from "@/lib/agent-memory/serialize";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = agentMemoryDecisionSchema.safeParse(await request.json());
  if (!parsed.success || !["accept", "dismiss"].includes(parsed.data.action)) {
    return NextResponse.json(
      { error: "Invalid candidate decision" },
      { status: 400 },
    );
  }

  try {
    const { candidateId } = await params;
    if (parsed.data.action === "dismiss") {
      const candidate = await dismissMemoryCandidate({
        candidateId,
        reason: parsed.data.reason,
      });
      return NextResponse.json({
        candidate: serializeAgentMemoryCandidate(candidate),
      });
    }
    const memory = await acceptMemoryCandidate({
      candidateId,
      actor: "user",
      reason: parsed.data.reason,
      statement: parsed.data.statement,
      supersedesMemoryId: parsed.data.targetMemoryId,
    });
    return NextResponse.json({ memory: serializeAgentMemory(memory) });
  } catch (error) {
    if (error instanceof AgentMemoryPolicyError) {
      const status = error.code === "not-found" ? 404 : 409;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    return NextResponse.json(
      { error: "Candidate decision failed" },
      { status: 500 },
    );
  }
}
