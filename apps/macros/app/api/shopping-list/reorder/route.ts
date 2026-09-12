import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { reorderShoppingListBodySchema } from "@/lib/shopping-list/contracts";
import { reorderShoppingList } from "@/lib/shopping-list/service";

export async function PATCH(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const parsed = reorderShoppingListBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reorder request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const items = await reorderShoppingList(
      session.user.id,
      parsed.data.itemIds,
    );
    return NextResponse.json({ items, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not reorder" },
      { status: 404 },
    );
  }
}
