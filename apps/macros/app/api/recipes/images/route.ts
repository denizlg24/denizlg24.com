import { randomUUID } from "node:crypto";
import type { MacrosRecipeImageUploadResponse } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import {
  createBodyPhotoDownloadUrl,
  createBodyPhotoUploadUrl,
  putBodyPhotoObject,
} from "@/lib/body/storage";
import { isJpeg, RECIPE_IMAGE_MAX_BYTES } from "@/lib/recipes/images";

/**
 * The app asks for a presigned PUT and uploads straight to storage. The web
 * editor sends the JPEG it re-encoded in the browser as the request body
 * instead, which keeps storage free of CORS rules and EXIF location data.
 */
export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const storageKey = `users/${session.user.id}/recipes/${randomUUID()}.jpg`;

  if (request.headers.get("content-type") === "image/jpeg") {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > RECIPE_IMAGE_MAX_BYTES)
      return NextResponse.json(
        { error: "Photos must be under 3 MB." },
        { status: 413 },
      );
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > RECIPE_IMAGE_MAX_BYTES)
      return NextResponse.json(
        { error: "Photos must be under 3 MB." },
        { status: 413 },
      );
    if (!isJpeg(bytes))
      return NextResponse.json(
        { error: "That file isn’t a JPEG photo." },
        { status: 415 },
      );
    await putBodyPhotoObject(storageKey, bytes, "image/jpeg");
    return NextResponse.json({
      storageKey,
      uploadUrl: null,
      previewUrl: await createBodyPhotoDownloadUrl(storageKey, "image/jpeg"),
    } satisfies MacrosRecipeImageUploadResponse);
  }

  const [uploadUrl, previewUrl] = await Promise.all([
    createBodyPhotoUploadUrl(storageKey, "image/jpeg"),
    createBodyPhotoDownloadUrl(storageKey, "image/jpeg"),
  ]);
  return NextResponse.json({
    storageKey,
    uploadUrl,
    previewUrl,
  } satisfies MacrosRecipeImageUploadResponse);
}
