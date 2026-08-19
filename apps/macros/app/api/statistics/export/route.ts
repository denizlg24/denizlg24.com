import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/connection";
import { userProfiles } from "@/db/schema";
import { getRequiredSession } from "@/lib/api/session";
import {
  getStatistics,
  type StatisticsPeriod,
  statisticsPeriods,
  statisticsToCsv,
} from "@/lib/statistics/service";
import { toIsoDate } from "@/lib/weights/date-utils";

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const url = new URL(request.url);
  const requested = url.searchParams.get("period") ?? "all";
  const format = url.searchParams.get("format") ?? "json";
  if (
    !statisticsPeriods.includes(requested as StatisticsPeriod) ||
    !["json", "csv"].includes(format)
  )
    return NextResponse.json(
      { error: "Invalid export request" },
      { status: 400 },
    );
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
    columns: { timezone: true },
  });
  const data = await getStatistics(
    session.user.id,
    toIsoDate(new Date(), profile?.timezone ?? "UTC"),
    requested as StatisticsPeriod,
  );
  if (format === "csv")
    return new NextResponse(statisticsToCsv(data), {
      headers: {
        "content-disposition": "attachment; filename=macros-export.csv",
        "content-type": "text/csv; charset=utf-8",
      },
    });
  return NextResponse.json(data, {
    headers: {
      "content-disposition": "attachment; filename=macros-export.json",
    },
  });
}
