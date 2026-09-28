import {
  type MacrosCalendarTotals,
  macrosFoodLogCalendarTotalsQuerySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { getFoodLogCalendarTotals } from "@/lib/queries/food-log-calendar-totals";

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const url = new URL(request.url);
  const parsed = macrosFoodLogCalendarTotalsQuerySchema.safeParse({
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  const data = await getFoodLogCalendarTotals(
    session.user.id,
    parsed.data.start,
    parsed.data.end,
  );
  return NextResponse.json(data satisfies MacrosCalendarTotals);
}
