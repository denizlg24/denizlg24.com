import { profileUpdateSchema } from "@repo/schemas/stream";
import { NextResponse } from "next/server";

import { fail, parseBody, requireMember } from "@/lib/api";
import { deleteProfile, LastProfileError, updateProfile } from "@/lib/members";

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/v1/profiles/[id]">,
) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  const input = await parseBody(request, profileUpdateSchema);
  if (input instanceof NextResponse) return input;
  const { id } = await params;
  const profile = await updateProfile(caller.subject, id, input);
  return profile ? NextResponse.json(profile) : fail(404, "profile_not_found");
}

export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/v1/profiles/[id]">,
) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  const { id } = await params;
  try {
    const deleted = await deleteProfile(caller.subject, id);
    return deleted
      ? NextResponse.json({ success: true })
      : fail(404, "profile_not_found");
  } catch (error) {
    if (error instanceof LastProfileError) return fail(422, "last_profile");
    throw error;
  }
}
