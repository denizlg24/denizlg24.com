import { uploadFromUrlSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  fetchPublic,
  filenameFromUrl,
  readCappedBody,
} from "@/lib/public-fetch";
import { requireAdmin } from "@/lib/require-admin";
import { uploadFileToStorage } from "@/lib/storage-api";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = uploadFromUrlSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid upload request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { url, bucket, filename } = parsed.data;

  try {
    const response = await fetchPublic(url);
    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch ${url}: ${response.status}` },
        { status: 502 },
      );
    }
    const buffer = await readCappedBody(response);
    const file = new File([buffer], filename ?? filenameFromUrl(url), {
      type: response.headers.get("content-type") ?? "application/octet-stream",
    });
    const uploaded = await uploadFileToStorage(file, bucket);
    return NextResponse.json({
      url: uploaded.publicUrl,
      hash: uploaded.id,
      id: uploaded.id,
      size: uploaded.sizeBytes,
      name: file.name,
      mimeType: uploaded.mimeType || file.type,
    });
  } catch (error) {
    console.error("Error uploading from URL:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to upload from URL",
      },
      { status: 400 },
    );
  }
}
