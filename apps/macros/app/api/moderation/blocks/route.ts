import type { MacrosBlockedContributorsResponse } from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { listBlocks } from "@/lib/moderation/service";

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  return NextResponse.json({
    blocks: await listBlocks(session.user.id),
  } satisfies MacrosBlockedContributorsResponse);
}
