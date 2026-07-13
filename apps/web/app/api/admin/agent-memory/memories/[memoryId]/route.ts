import { agentMemoryDecisionSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import {
  archiveMemory,
  deleteMemory,
  editMemory,
  rollbackMemory,
} from "@/lib/agent-memory/governance";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import { serializeAgentMemory } from "@/lib/agent-memory/serialize";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentMemory, type IAgentMemory } from "@/models/AgentMemory";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memoryId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { memoryId } = await params;
  await connectDB();
  const memory = mongoose.isValidObjectId(memoryId)
    ? await AgentMemory.findById(memoryId)
    : null;
  if (!memory) {
    return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  }
  return NextResponse.json({ memory: serializeAgentMemory(memory) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ memoryId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = agentMemoryDecisionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid memory action" },
      { status: 400 },
    );
  }
  const { memoryId } = await params;

  try {
    let memory: IAgentMemory;
    if (parsed.data.action === "archive") {
      memory = await archiveMemory({ memoryId, reason: parsed.data.reason });
    } else if (parsed.data.action === "delete") {
      memory = await deleteMemory({ memoryId, reason: parsed.data.reason });
    } else if (
      parsed.data.action === "rollback" &&
      parsed.data.targetRevision
    ) {
      memory = await rollbackMemory({
        memoryId,
        targetRevision: parsed.data.targetRevision,
        reason: parsed.data.reason,
      });
    } else if (parsed.data.statement) {
      memory = await editMemory({
        memoryId,
        statement: parsed.data.statement,
        reason: parsed.data.reason,
      });
    } else {
      return NextResponse.json(
        { error: "Unsupported memory action" },
        { status: 400 },
      );
    }
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
      { error: "Memory action failed" },
      { status: 500 },
    );
  }
}
