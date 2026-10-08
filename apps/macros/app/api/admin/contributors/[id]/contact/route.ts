import type { MacrosRevealContactResponse } from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/api/admin-route";
import { revealContact } from "@/lib/moderation/admin";

/** POST, not GET: every reveal is an audited act, never a prefetch. */
export function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return adminRoute(async (actor) => {
    const { id } = await context.params;
    return NextResponse.json({
      email: await revealContact(actor, id),
    } satisfies MacrosRevealContactResponse);
  });
}
