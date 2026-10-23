import { memberSetupSchema } from "@repo/schemas/stream";
import { NextResponse } from "next/server";

import { authenticate, fail, parseBody } from "@/lib/api";
import { createMember, me } from "@/lib/members";

export async function GET(request: Request) {
  const caller = await authenticate(request);
  if (caller instanceof NextResponse) return caller;
  if (!caller.member) return fail(409, "needs_setup");
  return NextResponse.json(await me(caller.member));
}

export async function POST(request: Request) {
  const caller = await authenticate(request);
  if (caller instanceof NextResponse) return caller;
  const input = await parseBody(request, memberSetupSchema);
  if (input instanceof NextResponse) return input;
  const member = await createMember(caller.subject, input.name, input.color);
  return NextResponse.json(await me(member), { status: 201 });
}
