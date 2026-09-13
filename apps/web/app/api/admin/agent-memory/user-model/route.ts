import { type NextRequest, NextResponse } from "next/server";
import { serializeAgentUserModel } from "@/lib/agent-memory/serialize";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentUserModel } from "@/models/AgentUserModel";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  if (!(await getAgentMemorySettings()).releaseGates.reflection) {
    return NextResponse.json({ error: "Gate E is disabled" }, { status: 409 });
  }
  try {
    await connectDB();
    const model = await AgentUserModel.findById("singleton");
    return NextResponse.json({
      userModel: model ? serializeAgentUserModel(model) : null,
    });
  } catch (error) {
    console.error("Error loading user model:", error);
    return NextResponse.json(
      { error: "Failed to load user model" },
      { status: 500 },
    );
  }
}
