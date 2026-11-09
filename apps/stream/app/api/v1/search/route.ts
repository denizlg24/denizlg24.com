import { NextResponse } from "next/server";

import { requireAudience } from "@/lib/api";
import { audienceRules } from "@/lib/audience-rules";
import { searchCatalogue } from "@/lib/search";

export async function GET(request: Request) {
  const caller = await requireAudience(request);
  if (caller instanceof NextResponse) return caller;
  const params = new URL(request.url).searchParams;
  const type = params.get("type");
  return NextResponse.json(
    await searchCatalogue({
      q: (params.get("q") ?? "").slice(0, 120),
      rules: audienceRules(caller.profiles),
      type: type === "movie" || type === "series" ? type : null,
    }),
  );
}
