import { type NextRequest, NextResponse } from "next/server";
import { getStorageObject, isPubliclyServableKey } from "@/lib/storage-api";

export const runtime = "nodejs";
export const maxDuration = 30;

// Public, unauthenticated: blog images and the CV link render for anonymous
// visitors, and the desktop app fetches file URLs without a bearer header.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
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
      // Keys are UUID-suffixed and immutable, so responses cache indefinitely.
      "cache-control": "public, max-age=31536000, immutable",
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
