import { NextResponse } from "next/server";
import { latestAndroidRelease } from "../release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const release = await latestAndroidRelease().catch((error: unknown) => {
    console.error("[android] release lookup failed", error);
    return undefined;
  });
  if (release === undefined) {
    return NextResponse.json(
      { error: "The Android download is unavailable right now." },
      { status: 502 },
    );
  }
  if (release === null) {
    return NextResponse.json(
      { error: "No Android build has been published yet." },
      { status: 404 },
    );
  }

  // no-store: the data cache would buffer the whole APK in memory.
  const upstream = await fetch(release.apkUrl, { cache: "no-store" }).catch(
    () => null,
  );
  if (!upstream?.ok || !upstream.body) {
    return NextResponse.json(
      { error: "The Android download is unavailable right now." },
      { status: upstream?.status === 404 ? 404 : 502 },
    );
  }

  const headers = new Headers({
    "content-type": "application/vnd.android.package-archive",
    "content-disposition": `attachment; filename="Macros-${release.version}.apk"`,
    "cache-control": "no-store",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);

  return new Response(upstream.body, { headers });
}
