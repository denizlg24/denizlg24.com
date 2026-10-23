import { after, NextResponse } from "next/server";

import { runImdbIngest } from "@/lib/ingest";
import { authorizedJob } from "@/lib/jobs";

export const maxDuration = 3600;

/** Answers at once; the ingest takes minutes and records itself in `ingest_runs`. */
export function POST(request: Request) {
  if (!authorizedJob(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const withEpisodes =
    new URL(request.url).searchParams.get("episodes") !== "0";
  after(() =>
    runImdbIngest({
      withEpisodes,
      log: (message) => console.log(`[stream ingest] ${message}`),
    }).catch((error) => console.error("[stream ingest] failed", error)),
  );
  return NextResponse.json({ started: true }, { status: 202 });
}
