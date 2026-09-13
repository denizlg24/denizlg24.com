import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  normalizeParameters,
  serializeSemanticRun,
} from "@/lib/semantic-route-utils";
import {
  type ILeanKnowledgeSemanticRun,
  KnowledgeSemanticRun,
  SEMANTIC_DEFAULT_PARAMETERS,
} from "@/models/KnowledgeSemanticRun";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const limit = Math.min(
    50,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 10) || 10),
  );
  try {
    await connectDB();
    const runs = await KnowledgeSemanticRun.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<ILeanKnowledgeSemanticRun[]>()
      .exec();
    return NextResponse.json({ runs: runs.map(serializeSemanticRun) });
  } catch (error) {
    console.error("Error listing semantic runs:", error);
    return NextResponse.json(
      { error: "Failed to list semantic runs" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : "intfloat/multilingual-e5-small";

    await connectDB();
    const run = await KnowledgeSemanticRun.create({
      model,
      parameters: normalizeParameters(
        body.parameters,
        SEMANTIC_DEFAULT_PARAMETERS,
      ),
      status: "running",
      initiatedBy: body.initiatedBy === "script" ? "script" : "desktop",
    });

    const lean = await KnowledgeSemanticRun.findById(run._id)
      .lean<ILeanKnowledgeSemanticRun>()
      .exec();

    return NextResponse.json(
      { run: lean ? serializeSemanticRun(lean) : run.toObject() },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating semantic run:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
