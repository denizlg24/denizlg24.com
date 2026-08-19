import { NextResponse } from "next/server"
import { z } from "zod"

import { getRequiredSession } from "@/lib/api/session"
import {
  getNutritionOverview,
  type OverviewRange,
} from "@/lib/queries/nutrition-overview"

const querySchema = z.object({
  range: z.enum(["today", "yesterday", "1w", "1m", "3m", "1y"]).optional(),
  date: z.iso.date().optional(),
})

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    range: url.searchParams.get("range") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid range", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const range: OverviewRange = parsed.data.range ?? "yesterday"
  const payload = await getNutritionOverview(
    session.user.id,
    range,
    parsed.data.date
  )
  return NextResponse.json(payload)
}
