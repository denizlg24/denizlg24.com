import {
  type MacrosFoodDetailResponse,
  macrosBarcodeParamsSchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import {
  ensureExternalFoodSnapshot,
  getCustomFoodSnapshotByBarcode,
  toFoodSearchItem,
} from "@/lib/foods/service";
import { getNutritionFoodByBarcode } from "@/lib/foods/source";
import { hiddenItemIdsFor } from "@/lib/moderation/service";
import { toNutritionSourceErrorResponse } from "../../_lib/source-error-response";

const paramsSchema = macrosBarcodeParamsSchema;

export async function GET(
  _request: Request,
  context: { params: Promise<{ barcode: string }> },
) {
  const { session, response } = await getRequiredSession();

  if (!session) {
    return response;
  }

  const parsed = paramsSchema.safeParse(await context.params);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid barcode" }, { status: 400 });
  }

  const customFood = await getCustomFoodSnapshotByBarcode(
    session.user.id,
    parsed.data.barcode,
  );

  if (customFood) {
    return NextResponse.json({
      item: customFood.item,
      nutrition: customFood.nutrition,
      localFoodId: customFood.foodId,
      snapshotId: customFood.snapshotId,
      createdSnapshot: false,
      fetchedAt: new Date().toISOString(),
    } satisfies MacrosFoodDetailResponse);
  }

  try {
    const summary = await getNutritionFoodByBarcode(parsed.data.barcode);
    if ((await hiddenItemIdsFor(session.user.id)).has(summary.id)) {
      return NextResponse.json({ error: "Food not found" }, { status: 404 });
    }
    const result = await ensureExternalFoodSnapshot(summary.id, summary);

    return NextResponse.json({
      item: toFoodSearchItem(result.summary),
      nutrition: result.nutrition,
      localFoodId: result.foodId,
      snapshotId: result.snapshotId,
      createdSnapshot: result.createdSnapshot,
      fetchedAt: new Date().toISOString(),
    } satisfies MacrosFoodDetailResponse);
  } catch (error) {
    return toNutritionSourceErrorResponse(error);
  }
}
