import { paperProgressUpdateSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { serializePaper } from "@/lib/paper-citations";
import { requireAdmin } from "@/lib/require-admin";
import { type ILeanPaper, Paper } from "@/models/Paper";

interface ProgressRouteContext {
  params: Promise<{ paperId: string }>;
}

/**
 * Page turns are frequent and come from two devices reading the same PDF, so
 * the status transitions they imply are decided here rather than by whichever
 * client turned the page. Clients send only where they are.
 */
export async function PUT(request: NextRequest, context: ProgressRouteContext) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { paperId } = await context.params;
  if (!mongoose.Types.ObjectId.isValid(paperId))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const parsed = paperProgressUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid progress", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { currentPage, totalPages } = parsed.data;
    if (totalPages !== undefined && currentPage > totalPages) {
      return NextResponse.json(
        { error: "Page is beyond the end of the document" },
        { status: 400 },
      );
    }

    await connectDB();
    const previous = await Paper.findById(paperId)
      .select("readingStatus startedAt completedAt progress")
      .lean<ILeanPaper>()
      .exec();
    if (!previous)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const now = new Date();
    const set: Record<string, unknown> = {
      progress: {
        currentPage,
        totalPages: totalPages ?? previous.progress?.totalPages,
        updatedAt: now,
      },
    };

    if (previous.readingStatus === "unread") {
      set.readingStatus = "reading";
      if (!previous.startedAt) set.startedAt = now;
    }
    // Reaching the final page completes it, but only from "reading" — paging
    // back through something already finished must not re-stamp it, and
    // re-opening a completed paper at its last page is the common case.
    const total = totalPages ?? previous.progress?.totalPages;
    if (
      total !== undefined &&
      currentPage >= total &&
      previous.readingStatus === "reading"
    ) {
      set.readingStatus = "read";
      if (!previous.completedAt) set.completedAt = now;
    }

    const paper = await Paper.findByIdAndUpdate(
      paperId,
      { $set: set },
      { returnDocument: "after", runValidators: true },
    )
      .lean<ILeanPaper>()
      .exec();
    if (!paper)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ paper: serializePaper(paper) });
  } catch (error) {
    console.error("Failed to update reading progress:", error);
    return NextResponse.json(
      { error: "Failed to update reading progress" },
      { status: 500 },
    );
  }
}
