import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequiredSession } from "@/lib/api/session";
import { updateShoppingListItemBodySchema } from "@/lib/shopping-list/contracts";
import {
  deleteShoppingListItem,
  updateShoppingListItem,
} from "@/lib/shopping-list/service";

const paramsSchema = z.object({ id: z.uuid() });

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
  }

  const parsed = updateShoppingListItemBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid shopping list item", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const item = await updateShoppingListItem(
    session.user.id,
    params.data.id,
    parsed.data,
  );
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ item, fetchedAt: new Date().toISOString() });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
  }

  const deleted = await deleteShoppingListItem(session.user.id, params.data.id);
  if (!deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
