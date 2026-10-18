import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isSuspended } from "@/lib/moderation/service";

/** For server-rendered pages, which render a sign-in form instead of a 401. */
export async function getPageSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { session: null, suspended: false } as const;
  if (await isSuspended(session.user.id))
    return { session: null, suspended: true } as const;
  return { session, suspended: false } as const;
}
