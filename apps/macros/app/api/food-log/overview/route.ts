import {
  type MacrosNutritionOverview,
  macrosNutritionOverviewQuerySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import {
  getNutritionOverview,
  type OverviewRange,
} from "@/lib/queries/nutrition-overview";

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const url = new URL(request.url);
  const parsed = macrosNutritionOverviewQuerySchema.safeParse({
    range: url.searchParams.get("range") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid range", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const range: OverviewRange = parsed.data.range ?? "yesterday";
  const payload = await getNutritionOverview(
    session.user.id,
    range,
    parsed.data.date,
  );
  return NextResponse.json(payload satisfies MacrosNutritionOverview);
}
