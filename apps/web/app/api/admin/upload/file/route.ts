import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { uploadFileToStorage } from "@/lib/storage-api";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const data = await request.formData();
    const file: File | null = data.get("file") as unknown as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 413 },
      );
    }

    const uploaded = await uploadFileToStorage(file, "file");

    return NextResponse.json(
      {
        url: uploaded.publicUrl,
        hash: uploaded.id,
        id: uploaded.id,
        size: uploaded.sizeBytes,
        name: file.name,
        mimeType: uploaded.mimeType || file.type || "application/octet-stream",
      },
      { status: 200 },
    );
  } catch (error) {
    const err = error as Error;
    console.error("Error uploading file:", err);
    return NextResponse.json(
      { error: "Failed to upload file", details: err.message },
      { status: 500 },
    );
  }
}
