import { NextResponse } from "next/server";
import { adhocAssetUrl } from "../release";

// The workflow writes the manifest with https://macros.denizlg24.com/ios/adhoc/Macros.ipa
// in it, so both files reach the phone from this origin.
const CACHE_SECONDS = 60;

export async function GET() {
  const upstream = await fetch(adhocAssetUrl("manifest.plist"), {
    next: { revalidate: CACHE_SECONDS },
  }).catch(() => null);

  if (!upstream?.ok) {
    return NextResponse.json(
      { error: "No ad-hoc build has been published yet." },
      { status: upstream?.status === 404 ? 404 : 502 },
    );
  }

  return new NextResponse(await upstream.text(), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
    },
  });
}
