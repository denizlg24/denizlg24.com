import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getStorageObject, isPubliclyServableKey } from "@/lib/storage-api";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Authenticated binary transport for memory-card textures. The desktop admin
 * client reaches this through Tauri's HTTP plugin, so image rendering does not
 * depend on browser CORS behavior or on stale public-file cache metadata.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { key: segments } = await params;
  const key = segments.map((segment) => decodeURIComponent(segment)).join("/");
  if (!isPubliclyServableKey(key)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const object = await getStorageObject(key);
    if (!object) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const headers = new Headers({
      "content-type": object.contentType,
      // Objects are immutable, but this authenticated response must never enter
      // a shared cache.
      "cache-control": "private, max-age=31536000, immutable",
    });
    if (object.contentLength !== undefined) {
      headers.set("content-length", String(object.contentLength));
    }
    if (object.etag) headers.set("etag", object.etag);
    if (object.lastModified) {
      headers.set("last-modified", object.lastModified.toUTCString());
    }

    return new NextResponse(object.body, { headers });
  } catch {
    return NextResponse.json(
      { error: "Failed to read object" },
      { status: 502 },
    );
  }
}
