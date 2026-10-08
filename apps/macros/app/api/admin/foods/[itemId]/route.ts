import { macrosSetFoodRemovedBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { z } from "zod";

import { adminRoute, invalid, readJson } from "@/lib/api/admin-route";
import { setFoodRemoved } from "@/lib/moderation/admin";

const paramsSchema = z.object({ itemId: z.uuid() });

export function PUT(
  request: Request,
  context: { params: Promise<{ itemId: string }> },
) {
  return adminRoute(async (actor) => {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return invalid(params.error.issues);
    const body = macrosSetFoodRemovedBodySchema.safeParse(
      await readJson(request),
    );
    if (!body.success) return invalid(body.error.issues);

    await setFoodRemoved(
      actor,
      params.data.itemId,
      body.data.removed,
      body.data.reason || null,
    );
    return NextResponse.json({ ok: true });
  });
}
