import { paperHighlightInputSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { serializePaper } from "@/lib/paper-citations";
import { requireAdmin } from "@/lib/require-admin";
import { type ILeanPaper, Paper } from "@/models/Paper";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ paperId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { paperId } = await context.params;
  if (!mongoose.Types.ObjectId.isValid(paperId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = paperHighlightInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid paper highlight", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await connectDB();
    const highlight = {
      ...parsed.data,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const paper = await Paper.findByIdAndUpdate(
      paperId,
      { $push: { highlights: highlight } },
      { returnDocument: "after", runValidators: true },
    )
      .lean<ILeanPaper>()
      .exec();
    if (!paper)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(
      { paper: serializePaper(paper), highlightId: highlight.id },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to add paper highlight:", error);
    return NextResponse.json(
      { error: "Failed to add paper highlight" },
      { status: 500 },
    );
  }
}
