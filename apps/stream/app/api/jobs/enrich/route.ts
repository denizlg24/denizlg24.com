import { after, NextResponse } from "next/server";

import { authorizedJob } from "@/lib/jobs";
import { runEnrichment } from "@/lib/tmdb";

export const maxDuration = 3600;

export function POST(request: Request) {
  if (!authorizedJob(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 2000);
  after(() =>
    runEnrichment({
      limit: Number.isFinite(limit) ? Math.min(limit, 20_000) : 2000,
      log: (message) => console.log(`[stream enrich] ${message}`),
    }).catch((error) => console.error("[stream enrich] failed", error)),
  );
  return NextResponse.json({ started: true }, { status: 202 });
}
