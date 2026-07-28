import { type NextRequest, NextResponse } from "next/server";
import { serializeBackgroundAgentRun } from "@/lib/background-agent/serialize";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import { BackgroundAgentRun } from "@/models/BackgroundAgentRun";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  await connectDB();
  const { runId } = await params;
  const run = await BackgroundAgentRun.findById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ run: serializeBackgroundAgentRun(run) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  await connectDB();
  const { runId } = await params;
  const run = await BackgroundAgentRun.findOneAndUpdate(
    { _id: runId, status: "queued" },
    { $set: { status: "cancelled", completedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!run) {
    return NextResponse.json(
      { error: "Only queued runs can be cancelled" },
      { status: 409 },
    );
  }
  await AgentMemoryJob.updateOne(
    {
      idempotencyKey: `chat-run:${runId}`,
      status: { $in: ["pending", "retry"] },
    },
    { $set: { status: "cancelled", completedAt: new Date() } },
  );
  return NextResponse.json({ run: serializeBackgroundAgentRun(run) });
}
