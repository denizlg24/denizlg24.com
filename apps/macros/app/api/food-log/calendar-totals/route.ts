import { NextResponse } from "next/server"
import { z } from "zod"

import { getRequiredSession } from "@/lib/api/session"
import { getFoodLogCalendarTotals } from "@/lib/queries/food-log-calendar-totals"

const querySchema = z
  .object({
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .refine((data) => data.start <= data.end, {
    message: "start must be before or equal to end",
  })
  .refine(
    (data) => {
      const startDate = new Date(data.start)
      const endDate = new Date(data.end)
      const diffMs = endDate.getTime() - startDate.getTime()
      const diffDays = diffMs / (1000 * 60 * 60 * 24)
      const dayCount = Math.floor(diffDays) + 1
      return dayCount <= 370
    },
    {
      message: "date range cannot exceed 370 days",
    }
  )

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 })
  }

  const data = await getFoodLogCalendarTotals(
    session.user.id,
    parsed.data.start,
    parsed.data.end
  )
  return NextResponse.json(data)
}
