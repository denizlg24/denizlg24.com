import type { MacrosFoodSearchResponse } from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { foodSearchParamsSchema } from "@/lib/foods/contracts";
import { ownIconsByBarcode, syncStoredIcons } from "@/lib/foods/icons";
import {
  getFoodHistory,
  searchUserCustomFoods,
  toFoodSearchItem,
} from "@/lib/foods/service";
import { searchNutritionFoods } from "@/lib/foods/source";
import { hiddenItemIdsFor } from "@/lib/moderation/service";
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

  const [userItems, historyItems, sourceResult, hidden] = await Promise.all([
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
    hiddenItemIdsFor(session.user.id),
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
  // History rows come first, but their icons are stored copies: the source's
  // answer is the current one, and an icon the user picked beats both.
  const sourceItems = sourceResult.ok
    ? sourceResult.items.filter((summary) => !hidden.has(summary.id))
    : [];
  const sourceIcons = new Map(
    sourceItems.map((summary) => [summary.id, summary.iconKey]),
  );
  // Awaited, not deferred: a client that sees a new icon here refetches its
  // log straight away and must not read the old copy.
  await syncStoredIcons(sourceItems).catch(() => undefined);
  const ownIcons = await ownIconsByBarcode(session.user.id, [
    ...localHistory.map((item) => item.barcode),
    ...sourceItems.map((summary) => summary.barcode ?? null),
  ]);
  const iconFor = (barcode: string | null, fallback: string) =>
    (barcode && ownIcons.get(barcode)) || fallback;
  const seen = new Set<string>();
  const items = [
    ...localHistory.map((item) => ({
      ...item,
      iconKey: iconFor(item.barcode, sourceIcons.get(item.id) ?? item.iconKey),
    })),
    ...userItems,
    ...sourceItems.map((summary) => {
      const item = toFoodSearchItem(summary);
      return { ...item, iconKey: iconFor(item.barcode, item.iconKey) };
    }),
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
  } satisfies MacrosFoodSearchResponse);
}
