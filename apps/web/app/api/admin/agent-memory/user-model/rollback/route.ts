import { rollbackAgentUserModelSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import { rollbackUserModel } from "@/lib/agent-memory/reflection";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  if (!(await getAgentMemorySettings()).releaseGates.reflection) {
    return NextResponse.json({ error: "Gate E is disabled" }, { status: 409 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid rollback" }, { status: 400 });
  }
  const parsed = rollbackAgentUserModelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rollback" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await rollbackUserModel(parsed.data.targetRevision, parsed.data.reason),
    );
  } catch (error) {
    const status =
      error instanceof AgentMemoryPolicyError && error.code === "not-found"
        ? 404
        : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "User-model rollback failed",
      },
      { status },
    );
  }
}
