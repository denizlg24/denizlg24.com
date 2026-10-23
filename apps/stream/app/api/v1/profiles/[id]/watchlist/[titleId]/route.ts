import { NextResponse } from "next/server";

import { fail, requireProfile } from "@/lib/api";
import { findTitle, setWatchlist } from "@/lib/catalog";

type Context = RouteContext<"/api/v1/profiles/[id]/watchlist/[titleId]">;

async function toggle(request: Request, { params }: Context, present: boolean) {
  const { id, titleId } = await params;
  const caller = await requireProfile(request, id);
  if (caller instanceof NextResponse) return caller;
  if (present && !(await findTitle(titleId)))
    return fail(404, "title_not_found");
  await setWatchlist(caller.profile.id, titleId, present);
  return NextResponse.json({ inWatchlist: present });
}

export function PUT(request: Request, context: Context) {
  return toggle(request, context, true);
}

export function DELETE(request: Request, context: Context) {
  return toggle(request, context, false);
}
