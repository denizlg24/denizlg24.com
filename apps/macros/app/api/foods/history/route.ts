import type { MacrosFoodHistoryResponse } from "@repo/schemas/macros";
import { after, NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { foodHistoryQuerySchema } from "@/lib/foods/contracts";
import { refreshStaleIcons } from "@/lib/foods/icons";
import { getFoodHistory } from "@/lib/foods/service";

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession();

  if (!session) {
    return response;
  }

  const url = new URL(request.url);
  const parsed = foodHistoryQuerySchema.safeParse({
    at: url.searchParams.get("at") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid history query", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const items = await getFoodHistory(
    session.user.id,
    parsed.data.at,
    parsed.data.limit,
  );

  after(() =>
    refreshStaleIcons(items.map((item) => item.localFoodId)).catch(
      () => undefined,
    ),
  );

  return NextResponse.json({
    items,
    fetchedAt: new Date().toISOString(),
  } satisfies MacrosFoodHistoryResponse);
}
