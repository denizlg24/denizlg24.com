import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { foodSearchParamsSchema } from "@/lib/foods/contracts";
import {
  getFoodHistory,
  searchUserCustomFoods,
  toFoodSearchItem,
} from "@/lib/foods/service";
import { searchNutritionFoods } from "@/lib/foods/source";
import { toNutritionSourceErrorResponse } from "../_lib/source-error-response";

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession();

  if (!session) {
    return response;
  }

  const url = new URL(request.url);
  const parsed = foodSearchParamsSchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    brand: url.searchParams.get("brand") ?? undefined,
    lang: url.searchParams.get("lang") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    minScore: url.searchParams.get("minScore") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid food search", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const [userItems, historyItems, sourceResult] = await Promise.all([
    searchUserCustomFoods(
      session.user.id,
      parsed.data.q,
      parsed.data.brand,
      parsed.data.limit,
    ),
    getFoodHistory(session.user.id, undefined, parsed.data.limit),
    searchNutritionFoods(parsed.data)
      .then((items) => ({ ok: true as const, items }))
      .catch((error: unknown) => ({ ok: false as const, error })),
  ]);
  const query = parsed.data.q?.toLocaleLowerCase() ?? "";
  const localHistory = historyItems.filter((item) => {
    const matchesQuery =
      query.length === 0 ||
      item.name.toLocaleLowerCase().includes(query) ||
      item.brand?.toLocaleLowerCase().includes(query);
    const matchesBrand =
      !parsed.data.brand ||
      item.brand
        ?.toLocaleLowerCase()
        .includes(parsed.data.brand.toLocaleLowerCase());
    return matchesQuery && matchesBrand;
  });
  const seen = new Set<string>();
  const items = [
    ...localHistory,
    ...userItems,
    ...(sourceResult.ok ? sourceResult.items.map(toFoodSearchItem) : []),
  ].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  if (!sourceResult.ok && items.length === 0) {
    return toNutritionSourceErrorResponse(sourceResult.error);
  }
  return NextResponse.json({
    items: items.slice(0, parsed.data.limit),
    fetchedAt: new Date().toISOString(),
    sourceUnavailable: !sourceResult.ok,
  });
}
