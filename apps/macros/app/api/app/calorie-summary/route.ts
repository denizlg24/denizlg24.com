import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { getDailyCalorieSummary } from "@/lib/queries/calorie-summary"

export async function GET() {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const calorieSummary = await getDailyCalorieSummary(session.user.id)
  return NextResponse.json({
    calorieSummary,
    fetchedAt: new Date().toISOString(),
  })
}
