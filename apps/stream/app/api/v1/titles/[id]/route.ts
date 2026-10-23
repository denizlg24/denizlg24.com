import { NextResponse } from "next/server";

import { fail, profileParam, requireMember } from "@/lib/api";
import {
  findProgress,
  findTitle,
  inWatchlist,
  titleDetail,
} from "@/lib/catalog";
import { ownedProfile } from "@/lib/members";
import { enrichIfMissing } from "@/lib/tmdb";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/titles/[id]">,
) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  const { id } = await params;
  const row = await findTitle(id);
  if (!row) return fail(404, "title_not_found");
  const profileId = profileParam(request);
  const profile = profileId
    ? await ownedProfile(caller.subject, profileId)
    : null;
  const [title, saved, progress] = await Promise.all([
    enrichIfMissing(row).then(titleDetail),
    profile ? inWatchlist(profile.id, id) : false,
    profile ? findProgress(profile.id, id) : null,
  ]);
  return NextResponse.json({ title, inWatchlist: saved, progress });
}
