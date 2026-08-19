import { macrosFavoriteFoodBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequiredSession } from "@/lib/api/session";
import {
  listFavorites,
  removeFavorite,
  saveFavorite,
} from "@/lib/foods/entry-acceleration";

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  return NextResponse.json({ items: await listFavorites(session.user.id) });
}

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosFavoriteFoodBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid favorite", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(await saveFavorite(session.user.id, parsed.data), {
    status: 201,
  });
}

export async function DELETE(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = z
    .object({ foodId: z.uuid() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid favorite" }, { status: 400 });
  const removed = await removeFavorite(session.user.id, parsed.data.foodId);
  return removed
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "Favorite not found" }, { status: 404 });
}
