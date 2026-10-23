import { gridQuerySchema } from "@repo/schemas/stream";
import { NextResponse } from "next/server";

import { fail, requireAudience } from "@/lib/api";
import { gridWindow } from "@/lib/grid";

export async function GET(request: Request) {
  const caller = await requireAudience(request);
  if (caller instanceof NextResponse) return caller;
  const query = gridQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return fail(400, query.error.issues[0]?.message ?? "invalid_query");
  }
  const kids = caller.profiles.some((profile) => profile.kids);
  return NextResponse.json(await gridWindow(query.data, kids));
}
