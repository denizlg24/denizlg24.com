import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  computeStats,
  deleteStoredBook,
  type FortuneSheetBook,
  fetchBookFromStorage,
  getSpreadsheetById,
  uploadBookToStorage,
} from "@/lib/spreadsheets";
import { Spreadsheet } from "@/models/Spreadsheet";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const meta = await getSpreadsheetById(id);
    if (!meta) {
      return NextResponse.json(
        { error: "Spreadsheet not found" },
        { status: 404 },
      );
    }

    const content = await fetchBookFromStorage(meta.pinataHash, meta.pinataUrl);

    await connectDB();
    await Spreadsheet.findByIdAndUpdate(id, { lastOpenedAt: new Date() });

    return NextResponse.json({ spreadsheet: meta, content }, { status: 200 });
  } catch (error) {
    const err = error as Error;
    console.error("Error fetching spreadsheet:", err);
    return NextResponse.json(
      { error: "Failed to fetch spreadsheet", details: err.message },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    const {
      title,
      description,
      tags,
      content,
    }: {
      title?: string;
      description?: string;
      tags?: string[];
      content?: FortuneSheetBook;
    } = body;

    await connectDB();
    const existing = await Spreadsheet.findById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "Spreadsheet not found" },
        { status: 404 },
      );
    }

    const update: Record<string, unknown> = {};
    if (title !== undefined) update.title = title.trim();
    if (description !== undefined) update.description = description?.trim();
    if (tags !== undefined) update.tags = tags;

    if (content) {
      const stats = computeStats(content);
      const uploaded = await uploadBookToStorage(
        content,
        `${title ?? existing.title}.json`,
      );
      const oldCid = existing.pinataHash;
      const oldFileId = existing.pinataFileId;

      update.pinataHash = uploaded.cid;
      update.pinataFileId = uploaded.id;
      update.pinataUrl = uploaded.url;
      update.sizeBytes = uploaded.size;
      update.sheetCount = stats.sheetCount;
      update.rowCount = stats.rowCount;
      update.colCount = stats.colCount;

      // Delete the previous stored file after the replacement succeeds.
      if (oldCid && oldCid !== uploaded.cid) {
        deleteStoredBook(oldFileId, oldCid).catch(() => {});
      }
    }

    const updated = await Spreadsheet.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    })
      .lean()
      .exec();

    if (!updated) {
      return NextResponse.json(
        { error: "Spreadsheet not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        message: "Spreadsheet updated",
        spreadsheet: { ...updated, _id: updated._id.toString() },
      },
      { status: 200 },
    );
  } catch (error) {
    const err = error as Error;
    console.error("Error updating spreadsheet:", err);
    return NextResponse.json(
      { error: "Failed to update spreadsheet", details: err.message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    await connectDB();
    const doc = await Spreadsheet.findByIdAndDelete(id);
    if (!doc) {
      return NextResponse.json(
        { error: "Spreadsheet not found" },
        { status: 404 },
      );
    }

    await deleteStoredBook(doc.pinataFileId, doc.pinataHash);

    return NextResponse.json(
      { message: "Spreadsheet deleted" },
      { status: 200 },
    );
  } catch (error) {
    const err = error as Error;
    console.error("Error deleting spreadsheet:", err);
    return NextResponse.json(
      { error: "Failed to delete spreadsheet", details: err.message },
      { status: 500 },
    );
  }
}
