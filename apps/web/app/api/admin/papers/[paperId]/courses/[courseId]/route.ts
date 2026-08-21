import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { serializePaper } from "@/lib/paper-citations";
import { requireAdmin } from "@/lib/require-admin";
import { type ILeanPaper, Paper } from "@/models/Paper";

interface PaperCourseRouteContext {
  params: Promise<{ paperId: string; courseId: string }>;
}

/**
 * Unlinking through the mutation route would mean reading the whole array and
 * writing it back, which loses a link made from the other side of the app in
 * between. `$pull` names only the link being removed.
 */
export async function DELETE(
  request: NextRequest,
  context: PaperCourseRouteContext,
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { paperId, courseId } = await context.params;
  if (
    !mongoose.Types.ObjectId.isValid(paperId) ||
    !mongoose.Types.ObjectId.isValid(courseId)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await connectDB();
    const paper = await Paper.findByIdAndUpdate(
      paperId,
      { $pull: { courseIds: new mongoose.Types.ObjectId(courseId) } },
      { returnDocument: "after" },
    )
      .lean<ILeanPaper>()
      .exec();
    if (!paper)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ paper: serializePaper(paper) });
  } catch (error) {
    console.error("Failed to unlink paper from course:", error);
    return NextResponse.json(
      { error: "Failed to unlink paper from course" },
      { status: 500 },
    );
  }
}
