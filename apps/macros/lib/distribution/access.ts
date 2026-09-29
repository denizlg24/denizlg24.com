import { NextResponse } from "next/server";
import { timingSafeEqualText } from "@/lib/api/cron";
import { getRequiredSession } from "@/lib/api/session";
import { isOwnerEmail } from "@/lib/distribution/owners";

export async function requireOwner() {
  const { session, response } = await getRequiredSession();
  if (!session) return { session: null, response };

  if (!isOwnerEmail(session.user.email)) {
    return {
      session: null,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { session, response: null };
}

/** The ad-hoc release workflow's bearer, `MACROS_DISTRIBUTION_SECRET`. */
export function isAuthorizedDistributionCi(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  const secret = process.env.MACROS_DISTRIBUTION_SECRET;

  if (!secret || !authorization?.startsWith("Bearer ")) return false;

  return timingSafeEqualText(authorization.slice("Bearer ".length), secret);
}
