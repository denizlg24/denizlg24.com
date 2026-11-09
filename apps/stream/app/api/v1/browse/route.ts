import { browseTabSchema } from "@repo/schemas/stream";
import { NextResponse } from "next/server";

import { fail, requireAudience } from "@/lib/api";
import { buildBrowse } from "@/lib/browse";

export async function GET(request: Request) {
  const caller = await requireAudience(request);
  if (caller instanceof NextResponse) return caller;
  const tab = browseTabSchema.safeParse(
    new URL(request.url).searchParams.get("tab") ?? "home",
  );
  if (!tab.success) return fail(400, "invalid_tab");
  return NextResponse.json(await buildBrowse(caller.profiles, tab.data));
}
