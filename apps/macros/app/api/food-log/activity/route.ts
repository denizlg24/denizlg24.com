import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { getFoodLogActivityOverview } from "@/lib/food-logging/activity"

export async function GET() {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const activity = await getFoodLogActivityOverview(session.user.id)
  return NextResponse.json({ activity, fetchedAt: new Date().toISOString() })
}
