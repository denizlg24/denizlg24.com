import type { MacrosDistributionAccessResponse } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { isOwnerEmail } from "@/lib/distribution/owners";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  return NextResponse.json({
    owner: isOwnerEmail(session.user.email),
  } satisfies MacrosDistributionAccessResponse);
}
