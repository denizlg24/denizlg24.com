import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { isSuspended } from "@/lib/moderation/service";

export async function getRequiredSession() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // Sessions are deleted on suspension; this covers one minted in between.
  if (await isSuspended(session.user.id)) {
    return {
      session: null,
      response: NextResponse.json(
        { error: "This account has been suspended." },
        { status: 403 },
      ),
    };
  }

  return { session, response: null };
}
