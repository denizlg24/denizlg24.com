import {
  paperProgressMetadataSchema,
  paperProgressUpdateSchema,
} from "@repo/schemas";
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
 * The transition decided here is only valid for the state it was read from, so
 * the write is filtered on that state. A concurrent turn from the other device
 * lands first, this one misses, and the reader is told where the paper
 * actually is rather than dragging it back.
 */
function progressGuard(previous: ILeanPaper) {
  return {
    readingStatus: previous.readingStatus,
    ...(previous.progress?.updatedAt
      ? { "progress.updatedAt": previous.progress.updatedAt }
      : { "progress.updatedAt": { $exists: false } }),
  };
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

    await connectDB();
    const previous = await Paper.findById(paperId)
      .select("readingStatus startedAt completedAt progress")
      .lean<ILeanPaper>()
      .exec();
    if (!previous)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const total = totalPages ?? previous.progress?.totalPages;
    if (total !== undefined && currentPage > total) {
      return NextResponse.json(
        { error: "Page is beyond the end of the document" },
        { status: 400 },
      );
    }

    const now = new Date();
    const set: Record<string, unknown> = {
      progress: { currentPage, totalPages: total, updatedAt: now },
    };

    // The status the paper is in once this turn is applied, which is what the
    // completion check has to test: a one-page reading opened for the first
    // time is started and finished by the same request.
    let status = previous.readingStatus;
    if (status === "unread") {
      status = "reading";
      set.readingStatus = status;
      if (!previous.startedAt) set.startedAt = now;
    }
    // Reaching the final page completes it, but only from "reading" — paging
    // back through something already finished must not re-stamp it, and
    // re-opening a completed paper at its last page is the common case.
    if (total !== undefined && currentPage >= total && status === "reading") {
      set.readingStatus = "read";
      if (!previous.completedAt) set.completedAt = now;
    }

    const paper = await Paper.findOneAndUpdate(
      { _id: paperId, ...progressGuard(previous) },
      { $set: set },
      { returnDocument: "after", runValidators: true },
    )
      .lean<ILeanPaper>()
      .exec();
    if (paper) return NextResponse.json({ paper: serializePaper(paper) });

    const current = await Paper.findById(paperId).lean<ILeanPaper>().exec();
    if (!current)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ paper: serializePaper(current) });
  } catch (error) {
    console.error("Failed to update reading progress:", error);
    return NextResponse.json(
      { error: "Failed to update reading progress" },
      { status: 500 },
    );
  }
}

/**
 * Loading a PDF reveals its page count, and that is all this records. Opening
 * a reading is not reading it, so nothing here starts the clock: with no
 * position stored yet there is nothing to attach a page count to, and the
 * count is re-learned on the next load anyway.
 */
export async function PATCH(
  request: NextRequest,
  context: ProgressRouteContext,
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { paperId } = await context.params;
  if (!mongoose.Types.ObjectId.isValid(paperId))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const parsed = paperProgressMetadataSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid progress", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { totalPages } = parsed.data;

    await connectDB();
    const paper = await Paper.findOneAndUpdate(
      {
        _id: paperId,
        progress: { $exists: true },
        "progress.currentPage": { $lte: totalPages },
      },
      { $set: { "progress.totalPages": totalPages } },
      { returnDocument: "after", runValidators: true },
    )
      .lean<ILeanPaper>()
      .exec();
    if (paper) return NextResponse.json({ paper: serializePaper(paper) });

    const current = await Paper.findById(paperId).lean<ILeanPaper>().exec();
    if (!current)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ paper: serializePaper(current) });
  } catch (error) {
    console.error("Failed to record page count:", error);
    return NextResponse.json(
      { error: "Failed to record page count" },
      { status: 500 },
    );
  }
}
