import { profileInputSchema } from "@repo/schemas/stream";
import { NextResponse } from "next/server";

import { fail, parseBody, requireMember } from "@/lib/api";
import { createProfile, listProfiles, ProfileLimitError } from "@/lib/members";

export async function GET(request: Request) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  return NextResponse.json({ profiles: await listProfiles(caller.subject) });
}

export async function POST(request: Request) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  const input = await parseBody(request, profileInputSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await createProfile(caller.subject, input), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof ProfileLimitError) return fail(422, "profile_limit");
    throw error;
  }
}
