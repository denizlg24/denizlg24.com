import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { uploadFileToStorage } from "@/lib/storage-api";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PDF_SIZE = 50 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const data = await request.formData();
    const value = data.get("file");
    if (!(value instanceof File)) {
      return NextResponse.json({ error: "No PDF provided" }, { status: 400 });
    }
    if (value.size === 0 || value.size > MAX_PDF_SIZE) {
      return NextResponse.json(
        { error: "PDF must be between 1 byte and 50MB" },
        { status: 413 },
      );
    }
    if (
      value.type !== "application/pdf" ||
      !value.name.toLowerCase().endsWith(".pdf")
    ) {
      return NextResponse.json(
        { error: "Only PDF files are accepted" },
        { status: 415 },
      );
    }
    const signature = new TextDecoder().decode(
      new Uint8Array(await value.slice(0, 5).arrayBuffer()),
    );
    if (signature !== "%PDF-") {
      return NextResponse.json({ error: "Invalid PDF file" }, { status: 415 });
    }

    const uploaded = await uploadFileToStorage(value, "file");
    return NextResponse.json({
      pdf: {
        url: uploaded.publicUrl,
        storageKey: uploaded.id,
        fileName: value.name,
        mimeType: "application/pdf" as const,
        sizeBytes: uploaded.sizeBytes,
      },
    });
  } catch (error) {
    console.error("Failed to upload paper PDF:", error);
    return NextResponse.json(
      { error: "Failed to upload PDF" },
      { status: 500 },
    );
  }
}
