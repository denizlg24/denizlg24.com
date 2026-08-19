import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/connection"
import { userProfiles } from "@/db/schema"
import { getRequiredSession } from "@/lib/api/session"
import { getFoodLogDay, toIsoDate } from "@/lib/queries/food-log-day"

const querySchema = z.object({
  date: z.iso.date().optional(),
})

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    date: url.searchParams.get("date") ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid date", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  let date = parsed.data.date
  if (!date) {
    const profile = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, session.user.id),
      columns: { timezone: true },
    })
    const timezone = profile?.timezone ?? "UTC"
    date = toIsoDate(new Date(), timezone)
  }
  const payload = await getFoodLogDay(session.user.id, date)
  return NextResponse.json(payload)
}
