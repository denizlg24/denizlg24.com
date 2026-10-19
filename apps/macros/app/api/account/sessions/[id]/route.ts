import type { MacrosOkResponse } from "@repo/schemas/macros";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { findSessionToken } from "@/lib/account/devices";
import { getRequiredSession } from "@/lib/api/session";
import { auth } from "@/lib/auth";

/** Signs out one of the caller's other devices without exposing its token. */
export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/account/sessions/[id]">,
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const { id } = await context.params;
  if (id === session.session.id) {
    return NextResponse.json(
      { error: "Sign out to end the session on this device." },
      { status: 400 },
    );
  }

  const token = await findSessionToken(session.user.id, id);
  if (!token) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  await auth.api.revokeSession({ body: { token }, headers: await headers() });
  return NextResponse.json({ ok: true } satisfies MacrosOkResponse);
}
