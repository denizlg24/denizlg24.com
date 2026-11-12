import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { downloadBytesFromStorage } from "@/lib/storage-api";
import { StudyDocument } from "@/models/StudyDocument";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await connectDB();
    const document = await StudyDocument.findById(id)
      .select("storageKey fileName")
      .lean<{ storageKey: string; fileName: string }>()
      .exec();
    if (!document) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const bytes = await downloadBytesFromStorage(document.storageKey);
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Failed to serve study document:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
