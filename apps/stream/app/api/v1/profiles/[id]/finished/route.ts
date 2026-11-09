import { NextResponse } from "next/server";

import { requireProfile } from "@/lib/api";
import { finishedTitles } from "@/lib/catalog";

/** "Recently finished" on My Stream, newest first. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/profiles/[id]/finished">,
) {
  const caller = await requireProfile(request, (await params).id);
  if (caller instanceof NextResponse) return caller;
  return NextResponse.json({
    titles: await finishedTitles(caller.profile.id, 40),
  });
}
