import { paperMutationSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { after, type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { serializePaper } from "@/lib/paper-citations";
import { deleteLinkedPaperNote, syncPaperNote } from "@/lib/paper-notes";
import {
  isDuplicatePaperError,
  preparePaperUpdate,
} from "@/lib/paper-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { deleteFileFromStorage } from "@/lib/storage-api";
import { type ILeanPaper, Paper } from "@/models/Paper";

interface PaperRouteContext {
  params: Promise<{ paperId: string }>;
}

async function paperIdFrom(context: PaperRouteContext) {
  const { paperId } = await context.params;
  return mongoose.Types.ObjectId.isValid(paperId) ? paperId : undefined;
}

export async function GET(request: NextRequest, context: PaperRouteContext) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const paperId = await paperIdFrom(context);
  if (!paperId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await connectDB();
    const paper = await Paper.findById(paperId).lean<ILeanPaper>().exec();
    return paper
      ? NextResponse.json({ paper: serializePaper(paper) })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("Failed to load paper:", error);
    return NextResponse.json(
      { error: "Failed to load paper" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: PaperRouteContext) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const paperId = await paperIdFrom(context);
  if (!paperId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const parsed = paperMutationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid paper", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await connectDB();
    const previous = await Paper.findById(paperId)
      .select("pdf")
      .lean<ILeanPaper>()
      .exec();
    if (!previous)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const mutation = await preparePaperUpdate(parsed.data);
    const paper = await Paper.findByIdAndUpdate(paperId, mutation, {
      returnDocument: "after",
      runValidators: true,
    })
      .lean<ILeanPaper>()
      .exec();
    if (!paper)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await syncPaperNote(paper);

    const previousKey = previous.pdf?.storageKey;
    const nextKey = paper.pdf?.storageKey;
    if (previousKey && previousKey !== nextKey) {
      after(() =>
        deleteFileFromStorage(previousKey).catch((error) =>
          console.error("Failed to delete replaced paper PDF:", error),
        ),
      );
    }
    return NextResponse.json({ paper: serializePaper(paper) });
  } catch (error) {
    if (isDuplicatePaperError(error)) {
      return NextResponse.json(
        { error: "DOI, arXiv id, or citation key is already in use" },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      /^(Invalid|Citation|Highlight)/.test(error.message)
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to update paper:", error);
    return NextResponse.json(
      { error: "Failed to update paper" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: PaperRouteContext) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const paperId = await paperIdFrom(context);
  if (!paperId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await connectDB();
    const paper = await Paper.findByIdAndDelete(paperId)
      .select("pdf")
      .lean<ILeanPaper>()
      .exec();
    if (!paper)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    await deleteLinkedPaperNote(paper);
    if (paper.pdf?.storageKey) {
      await deleteFileFromStorage(paper.pdf.storageKey).catch((error) =>
        console.error("Failed to delete paper PDF:", error),
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete paper:", error);
    return NextResponse.json(
      { error: "Failed to delete paper" },
      { status: 500 },
    );
  }
}
