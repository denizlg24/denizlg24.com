import { NextResponse } from "next/server";

import { requireAudience } from "@/lib/api";
import { mapHighlights } from "@/lib/map";

export async function GET(request: Request) {
  const caller = await requireAudience(request);
  if (caller instanceof NextResponse) return caller;
  return NextResponse.json({
    highlights: await mapHighlights(caller.profiles),
  });
}
