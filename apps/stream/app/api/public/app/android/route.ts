import { NextResponse } from "next/server";

import { latestAndroidRelease } from "@/lib/app-release";

/** The phone and TV apps ask here whether a newer signed APK exists. */
export async function GET() {
  try {
    const release = await latestAndroidRelease();
    if (!release) {
      return NextResponse.json({ error: "no_release" }, { status: 404 });
    }
    return NextResponse.json(release, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (error) {
    console.error("[stream] android release lookup failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
