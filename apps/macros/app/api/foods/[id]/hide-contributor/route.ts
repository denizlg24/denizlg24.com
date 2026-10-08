import type { MacrosBlockContributorResponse } from "@repo/schemas/macros";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/connection";
import { foods } from "@/db/schema";
import { getRequiredSession } from "@/lib/api/session";
import { getNutritionFoodSummary } from "@/lib/foods/source";
import { blockContributor, ModerationError } from "@/lib/moderation/service";

const paramsSchema = z.object({ id: z.uuid() });

async function labelFor(itemId: string) {
  const stored = await db.query.foods.findFirst({
    where: eq(foods.externalItemId, itemId),
    columns: { name: true, brand: true },
  });
  const food = stored ?? (await getNutritionFoodSummary(itemId));
  return food.brand ? `${food.name} · ${food.brand}` : food.name;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid food id" }, { status: 400 });
  }

  try {
    const block = await blockContributor(
      session.user.id,
      parsed.data.id,
      await labelFor(parsed.data.id),
    );
    return NextResponse.json(
      {
        block: {
          id: block.id,
          label: block.viaLabel,
          createdAt: block.createdAt.toISOString(),
        },
      } satisfies MacrosBlockContributorResponse,
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ModerationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
