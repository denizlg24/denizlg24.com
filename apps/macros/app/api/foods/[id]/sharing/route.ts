import type { MacrosFoodSharing } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequiredSession } from "@/lib/api/session";
import { getFoodSharing } from "@/lib/moderation/service";

const paramsSchema = z.object({ id: z.uuid() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid food id" }, { status: 400 });
  }

  return NextResponse.json(
    (await getFoodSharing(
      session.user.id,
      parsed.data.id,
    )) satisfies MacrosFoodSharing,
  );
}
