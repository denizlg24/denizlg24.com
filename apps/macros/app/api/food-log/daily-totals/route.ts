import { NextResponse } from "next/server"

import { getRequiredSession } from "@/lib/api/session"
import { getDailyNutrientTotals } from "@/lib/queries/daily-nutrient-totals"

export async function GET() {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const totals = await getDailyNutrientTotals(session.user.id)
  return NextResponse.json({ totals })
}
