import { NextResponse } from "next/server";

import { requireMember } from "@/lib/api";
import { mapMeta } from "@/lib/map";

export async function GET(request: Request) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  return NextResponse.json(mapMeta(), {
    headers: { "Cache-Control": "private, max-age=86400" },
  });
}
