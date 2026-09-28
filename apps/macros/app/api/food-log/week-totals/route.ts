import {
  type MacrosWeekTotals,
  macrosFoodLogWeekTotalsQuerySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { getFoodLogWeekTotals } from "@/lib/queries/food-log-week-totals";

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const url = new URL(request.url);
  const parsed = macrosFoodLogWeekTotalsQuerySchema.safeParse({
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  const data = await getFoodLogWeekTotals(
    session.user.id,
    parsed.data.start,
    parsed.data.end,
  );
  return NextResponse.json(data satisfies MacrosWeekTotals);
}
