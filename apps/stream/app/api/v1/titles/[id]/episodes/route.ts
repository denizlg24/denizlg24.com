import { NextResponse } from "next/server";

import { requireMember } from "@/lib/api";
import { findTitle, listEpisodes } from "@/lib/catalog";
import { episodePreviews } from "@/lib/episode-previews";
import { enrichIfMissing } from "@/lib/tmdb";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/titles/[id]/episodes">,
) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  const { id } = await params;
  const season = new URL(request.url).searchParams.get("season");
  const parsed = season === null ? null : Number.parseInt(season, 10);
  const selected = parsed !== null && Number.isFinite(parsed) ? parsed : null;
  const episodes = await listEpisodes(id, selected);
  if (selected === null) return NextResponse.json({ episodes });
  const found = await findTitle(id);
  const title = found ? await enrichIfMissing(found) : null;
  return NextResponse.json({
    episodes: await episodePreviews(episodes, title?.tmdbId ?? null, selected),
  });
}
