import { NextResponse } from "next/server";

import { fail, requireAudience } from "@/lib/api";
import { findTitle } from "@/lib/catalog";
import { similarTitles } from "@/lib/similar";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await requireAudience(request);
  if (caller instanceof NextResponse) return caller;
  const row = await findTitle((await params).id);
  if (!row) return fail(404, "title_not_found");
  return NextResponse.json({
    titles: await similarTitles(row, caller.profiles),
  });
}
