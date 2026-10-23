import { mapQuerySchema } from "@repo/schemas/stream";
import { NextResponse } from "next/server";

import { fail, profileParam, requireMember } from "@/lib/api";
import { mapRegion } from "@/lib/map";
import { ownedProfile } from "@/lib/members";

export async function GET(request: Request) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  const query = mapQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return fail(400, query.error.issues[0]?.message ?? "invalid_query");
  }
  const profileId = profileParam(request);
  const profile = profileId
    ? await ownedProfile(caller.subject, profileId)
    : null;
  return NextResponse.json(await mapRegion(query.data, profile?.kids ?? false));
}
