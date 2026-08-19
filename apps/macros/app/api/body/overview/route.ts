import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/connection";
import { userProfiles } from "@/db/schema";
import { getRequiredSession } from "@/lib/api/session";
import { getBodyOverview } from "@/lib/body/service";
import { toIsoDate } from "@/lib/weights/date-utils";

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
    columns: { timezone: true },
  });
  return NextResponse.json({
    overview: await getBodyOverview(
      session.user.id,
      toIsoDate(new Date(), profile?.timezone ?? "UTC"),
    ),
  });
}
