import {
  type BackgroundAgentRunList,
  createBackgroundAgentRunSchema,
} from "@repo/schemas";
import { after, type NextRequest, NextResponse } from "next/server";
import {
  drainOneBackgroundAgentJob,
  enqueueBackgroundAgentRun,
} from "@/lib/background-agent/execution";
import { serializeBackgroundAgentRun } from "@/lib/background-agent/serialize";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { BackgroundAgentRun } from "@/models/BackgroundAgentRun";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  await connectDB();
  const activeOnly = new URL(request.url).searchParams.get("active") === "true";
  const runs = await BackgroundAgentRun.find(
    activeOnly ? { status: { $in: ["queued", "running"] } } : {},
  )
    .sort({ createdAt: -1 })
    .limit(activeOnly ? 20 : 50);
  const response: BackgroundAgentRunList = {
    runs: runs.map(serializeBackgroundAgentRun),
  };
  return NextResponse.json(response);
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = createBackgroundAgentRunSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid run" },
      { status: 400 },
    );
  }
  try {
    const run = await enqueueBackgroundAgentRun(parsed.data);
    after(async () => {
      try {
        await drainOneBackgroundAgentJob(run._id.toString());
      } catch (error) {
        console.error("[Background Agent] Immediate drain failed", error);
      }
    });
    return NextResponse.json(
      { run: serializeBackgroundAgentRun(run) },
      { status: 202 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start agent run";
    return NextResponse.json(
      { error: message },
      { status: message === "Conversation not found" ? 404 : 500 },
    );
  }
}
