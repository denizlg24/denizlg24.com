import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/connection";
import { userProfiles } from "@/db/schema";
import { getRequiredSession } from "@/lib/api/session";
import {
  getStatistics,
  type StatisticsPeriod,
  statisticsPeriods,
} from "@/lib/statistics/service";
import { toIsoDate } from "@/lib/weights/date-utils";

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const requested = new URL(request.url).searchParams.get("period") ?? "28d";
  if (!statisticsPeriods.includes(requested as StatisticsPeriod))
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
    columns: { timezone: true },
  });
  const statistics = await getStatistics(
    session.user.id,
    toIsoDate(new Date(), profile?.timezone ?? "UTC"),
    requested as StatisticsPeriod,
  );
  return NextResponse.json({ statistics });
}
