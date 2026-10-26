import { NextResponse } from "next/server";

import { fail, requireMember } from "@/lib/api";
import { findTitle } from "@/lib/catalog";
import { EpisodeNotFoundError, subtitlesFor } from "@/lib/subtitles";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/titles/[id]/subtitles">,
) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  const { id } = await params;
  const title = await findTitle(id);
  if (!title) return fail(404, "title_not_found");
  const episode = new URL(request.url).searchParams.get("episode");
  try {
    return NextResponse.json(await subtitlesFor(title, episode));
  } catch (error) {
    if (error instanceof EpisodeNotFoundError)
      return fail(404, "episode_not_found");
    throw error;
  }
}
