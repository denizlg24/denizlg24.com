import { updateAgentProcedureSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { updateProcedure } from "@/lib/agent-memory/lifecycle";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import { serializeAgentProcedure } from "@/lib/agent-memory/serialize";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ procedureId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  if (!(await getAgentMemorySettings()).releaseGates.reflection) {
    return NextResponse.json({ error: "Gate E is disabled" }, { status: 409 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid procedure update" },
      { status: 400 },
    );
  }
  const parsed = updateAgentProcedureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid procedure update" },
      { status: 400 },
    );
  }
  try {
    const { procedureId } = await params;
    return NextResponse.json({
      procedure: serializeAgentProcedure(
        await updateProcedure(procedureId, parsed.data),
      ),
    });
  } catch (error) {
    const status =
      error instanceof AgentMemoryPolicyError && error.code === "not-found"
        ? 404
        : error instanceof AgentMemoryPolicyError
          ? 409
          : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Procedure update failed",
      },
      { status },
    );
  }
}
