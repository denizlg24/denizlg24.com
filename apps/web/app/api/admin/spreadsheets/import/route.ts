import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  computeStats,
  uploadBookToStorage,
  xlsxBufferToBook,
} from "@/lib/spreadsheets";
import { Spreadsheet } from "@/models/Spreadsheet";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const title = (form.get("title") as string | null)?.trim();
    const description = (form.get("description") as string | null)?.trim();
    const tagsRaw = form.get("tags") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 413 },
      );
    }

    const buffer = await file.arrayBuffer();
    const book = xlsxBufferToBook(buffer);
    const stats = computeStats(book);
    const finalTitle = title || file.name.replace(/\.(xlsx|xls|csv)$/i, "");

    const uploaded = await uploadBookToStorage(book, `${finalTitle}.json`);

    await connectDB();
    const doc = await Spreadsheet.create({
      title: finalTitle,
      description,
      tags: tagsRaw
        ? tagsRaw
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
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
        message: "Spreadsheet imported",
        spreadsheet: { ...doc.toObject(), _id: doc._id.toString() },
      },
      { status: 201 },
    );
  } catch (error) {
    const err = error as Error;
    console.error("Error importing spreadsheet:", err);
    return NextResponse.json(
      { error: "Failed to import spreadsheet", details: err.message },
      { status: 500 },
    );
  }
}
