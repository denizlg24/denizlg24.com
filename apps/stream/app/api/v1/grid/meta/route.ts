import { titleIdSchema } from "@repo/schemas/stream";
import { NextResponse } from "next/server";

import { requireAudience } from "@/lib/api";
import { gridMeta } from "@/lib/grid";

export async function GET(request: Request) {
  const caller = await requireAudience(request);
  if (caller instanceof NextResponse) return caller;
  const params = new URL(request.url).searchParams;
  const type = params.get("type");
  const focus = titleIdSchema.safeParse(params.get("focus"));
  const kind = type === "movie" || type === "series" ? type : "all";
  const kids = caller.profiles.some((profile) => profile.kids);
  return NextResponse.json(
    await gridMeta(
      kids,
      kind,
      caller.profiles,
      focus.success ? focus.data : null,
    ),
  );
}
