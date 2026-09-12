import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { createShoppingListItemBodySchema } from "@/lib/shopping-list/contracts";
import {
  clearCheckedShoppingListItems,
  createShoppingListItem,
  getShoppingList,
} from "@/lib/shopping-list/service";

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const items = await getShoppingList(session.user.id);
  return NextResponse.json({ items, fetchedAt: new Date().toISOString() });
}

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const parsed = createShoppingListItemBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid shopping list item", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const item = await createShoppingListItem(session.user.id, parsed.data);
  return NextResponse.json(
    { item, fetchedAt: new Date().toISOString() },
    { status: 201 },
  );
}

export async function DELETE() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const cleared = await clearCheckedShoppingListItems(session.user.id);
  return NextResponse.json({ cleared });
}
