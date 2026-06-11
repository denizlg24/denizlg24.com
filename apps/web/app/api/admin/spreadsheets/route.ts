import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  computeStats,
  emptyBook,
  type FortuneSheetBook,
  getAllSpreadsheets,
  uploadBookToStorage,
} from "@/lib/spreadsheets";
import { Spreadsheet } from "@/models/Spreadsheet";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const spreadsheets = await getAllSpreadsheets();
    return NextResponse.json({ spreadsheets }, { status: 200 });
  } catch (error) {
    console.error("Error fetching spreadsheets:", error);
    return NextResponse.json(
      { error: "Failed to fetch spreadsheets" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      title,
      description,
      tags,
      content,
    }: {
      title: string;
      description?: string;
      tags?: string[];
      content?: FortuneSheetBook;
    } = body;

    if (!title || !title.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const book = content && content.length > 0 ? content : emptyBook();
    const stats = computeStats(book);
    const uploaded = await uploadBookToStorage(book, `${title}.json`);

    await connectDB();
    const doc = await Spreadsheet.create({
      title: title.trim(),
      description: description?.trim(),
      tags: tags ?? [],
      pinataHash: uploaded.cid,
      pinataFileId: uploaded.id,
      pinataUrl: uploaded.url,
      sizeBytes: uploaded.size,
      sheetCount: stats.sheetCount,
      rowCount: stats.rowCount,
      colCount: stats.colCount,
    });

    return NextResponse.json(
      {
        message: "Spreadsheet created",
        spreadsheet: {
          ...doc.toObject(),
          _id: doc._id.toString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const err = error as Error;
    console.error("Error creating spreadsheet:", err);
    return NextResponse.json(
      { error: "Failed to create spreadsheet", details: err.message },
      { status: 500 },
    );
  }
}
