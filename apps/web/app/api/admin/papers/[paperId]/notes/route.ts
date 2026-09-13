import { paperNoteLinkSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { serializePaper } from "@/lib/paper-citations";
import { requireAdmin } from "@/lib/require-admin";
import { Note } from "@/models/Note";
import { type ILeanPaper, Paper } from "@/models/Paper";

/** `$addToSet` so a link made elsewhere between read and write survives. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ paperId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { paperId } = await context.params;
  const parsed = paperNoteLinkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid note link", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { noteId } = parsed.data;
  if (
    !mongoose.Types.ObjectId.isValid(paperId) ||
    !mongoose.Types.ObjectId.isValid(noteId)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await connectDB();
    if (!(await Note.exists({ _id: noteId }))) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    const paper = await Paper.findByIdAndUpdate(
      paperId,
      { $addToSet: { noteIds: new mongoose.Types.ObjectId(noteId) } },
      { returnDocument: "after" },
    )
      .lean<ILeanPaper>()
      .exec();
    if (!paper)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ paper: serializePaper(paper) });
  } catch (error) {
    console.error("Failed to link note to paper:", error);
    return NextResponse.json(
      { error: "Failed to link note to paper" },
      { status: 500 },
    );
  }
}
