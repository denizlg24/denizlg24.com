import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { serializeSemanticRun } from "@/lib/semantic-route-utils";
import {
  type ILeanKnowledgeSemanticRun,
  KnowledgeSemanticRun,
} from "@/models/KnowledgeSemanticRun";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    await connectDB();

    const run = await KnowledgeSemanticRun.findByIdAndUpdate(
      id,
      {
        $set: {
          status: body.status === "failed" ? "failed" : "completed",
          completedAt: new Date(),
          embeddedCount:
            typeof body.embeddedCount === "number" ? body.embeddedCount : 0,
          staleCount: typeof body.staleCount === "number" ? body.staleCount : 0,
          edgeCount: typeof body.edgeCount === "number" ? body.edgeCount : 0,
          clusterCount:
            typeof body.clusterCount === "number" ? body.clusterCount : 0,
          error: typeof body.error === "string" ? body.error : undefined,
        },
      },
      { new: true },
    )
      .lean<ILeanKnowledgeSemanticRun>()
      .exec();

    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ run: serializeSemanticRun(run) });
  } catch (error) {
    console.error("Error completing semantic run:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
