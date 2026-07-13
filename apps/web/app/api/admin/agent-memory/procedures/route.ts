import { createAgentProcedureSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { createProcedure } from "@/lib/agent-memory/lifecycle";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import { serializeAgentProcedure } from "@/lib/agent-memory/serialize";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentProcedure } from "@/models/AgentProcedure";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  await connectDB();
  const procedures = await AgentProcedure.find()
    .sort({ lifecycle: 1, confidence: -1, updatedAt: -1 })
    .limit(200);
  return NextResponse.json({
    procedures: procedures.map(serializeAgentProcedure),
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  if (!(await getAgentMemorySettings()).releaseGates.reflection) {
    return NextResponse.json({ error: "Gate E is disabled" }, { status: 409 });
  }
  const parsed = createAgentProcedureSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid procedure" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      procedure: serializeAgentProcedure(await createProcedure(parsed.data)),
    });
  } catch (error) {
    const status = error instanceof AgentMemoryPolicyError ? 409 : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Procedure creation failed",
      },
      { status },
    );
  }
}
