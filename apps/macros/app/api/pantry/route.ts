import {
  type MacrosPantryResponse,
  macrosSetPantryItemBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { getPantry, setPantryItem } from "@/lib/pantry/service";
import { toNutritionSourceErrorResponse } from "../foods/_lib/source-error-response";

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  return NextResponse.json({
    items: await getPantry(session.user.id),
    fetchedAt: new Date().toISOString(),
  } satisfies MacrosPantryResponse);
}
export async function PUT(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosSetPantryItemBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Enter a valid food and stock quantity",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  try {
    await setPantryItem(session.user.id, parsed.data);
  } catch (error) {
    return toNutritionSourceErrorResponse(error);
  }
  return NextResponse.json({
    items: await getPantry(session.user.id),
    fetchedAt: new Date().toISOString(),
  } satisfies MacrosPantryResponse);
}
