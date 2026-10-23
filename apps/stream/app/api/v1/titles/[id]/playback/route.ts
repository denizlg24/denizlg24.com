import { NextResponse } from "next/server";

import { fail, profileParam, requireMember } from "@/lib/api";
import { findTitle } from "@/lib/catalog";
import { ownedProfile } from "@/lib/members";
import { playbackFor } from "@/lib/playback";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/titles/[id]/playback">,
) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  const { id } = await params;
  const title = await findTitle(id);
  if (!title) return fail(404, "title_not_found");
  const profileId = profileParam(request);
  const profile = profileId
    ? await ownedProfile(caller.subject, profileId)
    : null;
  const episode = new URL(request.url).searchParams.get("episode");
  try {
    return NextResponse.json(
      await playbackFor(title, profile?.id ?? null, episode),
    );
  } catch (error) {
    if (error instanceof RangeError) return fail(404, "episode_not_found");
    throw error;
  }
}
