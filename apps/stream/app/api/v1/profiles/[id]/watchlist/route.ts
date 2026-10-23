import { NextResponse } from "next/server";

import { requireProfile } from "@/lib/api";
import { listWatchlist } from "@/lib/catalog";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/profiles/[id]/watchlist">,
) {
  const { id } = await params;
  const caller = await requireProfile(request, id);
  if (caller instanceof NextResponse) return caller;
  return NextResponse.json({ titles: await listWatchlist(caller.profile.id) });
}
