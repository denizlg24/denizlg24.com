import { macrosSetRestrictionBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { adminRoute, invalid, readJson } from "@/lib/api/admin-route";
import { getContributor, setRestriction } from "@/lib/moderation/admin";

export function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return adminRoute(async (actor) => {
    const { id } = await context.params;
    const body = macrosSetRestrictionBodySchema.safeParse(
      await readJson(request),
    );
    if (!body.success) return invalid(body.error.issues);
    await setRestriction(actor, id, body.data);
    return NextResponse.json(await getContributor(id));
  });
}
