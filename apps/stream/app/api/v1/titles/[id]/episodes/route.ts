import { NextResponse } from "next/server";

import { requireMember } from "@/lib/api";
import { listEpisodes } from "@/lib/catalog";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/titles/[id]/episodes">,
) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  const { id } = await params;
  const season = new URL(request.url).searchParams.get("season");
  const parsed = season === null ? null : Number.parseInt(season, 10);
  return NextResponse.json({
    episodes: await listEpisodes(
      id,
      parsed !== null && Number.isFinite(parsed) ? parsed : null,
    ),
  });
}
