import { NextResponse } from "next/server";
import { adhocAssetUrl } from "../release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // no-store: the data cache would buffer the whole IPA in memory.
  const upstream = await fetch(adhocAssetUrl("Macros.ipa"), {
    cache: "no-store",
  }).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return NextResponse.json(
      { error: "No ad-hoc build has been published yet." },
      { status: upstream?.status === 404 ? 404 : 502 },
    );
  }

  const headers = new Headers({
    "content-type": "application/octet-stream",
    "content-disposition": 'attachment; filename="Macros.ipa"',
    "cache-control": "no-store",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);

  return new Response(upstream.body, { headers });
}
