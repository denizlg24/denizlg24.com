import {
  setAgentReleaseGateSchema,
  updateAgentMemorySettingsSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { AgentMemoryPolicyError } from "@/lib/agent-memory/policy";
import { serializeAgentMemorySettings } from "@/lib/agent-memory/serialize";
import {
  getAgentMemorySettings,
  setAgentReleaseGate,
  updateAgentMemorySettings,
} from "@/lib/agent-memory/settings";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json({
    settings: serializeAgentMemorySettings(await getAgentMemorySettings()),
  });
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const result = updateAgentMemorySettingsSchema.safeParse(body.settings);
    if (!result.success || typeof body.reason !== "string") {
      return NextResponse.json(
        { error: "Invalid settings update" },
        { status: 400 },
      );
    }
    const settings = await updateAgentMemorySettings(result.data, body.reason);
    return NextResponse.json({
      settings: serializeAgentMemorySettings(settings),
    });
  } catch (error) {
    if (error instanceof AgentMemoryPolicyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Settings update failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const parsed = setAgentReleaseGateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid gate transition" },
        { status: 400 },
      );
    }
    const settings = await setAgentReleaseGate(parsed.data);
    return NextResponse.json({
      settings: serializeAgentMemorySettings(settings),
    });
  } catch (error) {
    if (error instanceof AgentMemoryPolicyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Gate transition failed" },
      { status: 500 },
    );
  }
}
