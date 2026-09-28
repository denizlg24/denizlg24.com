import { NextResponse } from "next/server";

// Written by .github/workflows/release-macros-ios.yml on every iOS release.
// Serving it from this origin keeps the URL people add to SideStore stable
// whatever hosts the file.
const SOURCE_ASSET_URL =
  "https://github.com/denizlg24/denizlg24.com/releases/download/macros-ios-source/source.json";

const CACHE_SECONDS = 300;

export async function GET() {
  const upstream = await fetch(SOURCE_ASSET_URL, {
    next: { revalidate: CACHE_SECONDS },
  }).catch(() => null);

  if (!upstream?.ok) {
    return NextResponse.json(
      { error: "The iOS source is not available yet." },
      { status: upstream?.status === 404 ? 404 : 502 },
    );
  }

  return new NextResponse(await upstream.text(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
    },
  });
}
