import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { getWeightOverview } from "@/lib/weights/queries"

export async function GET() {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const overview = await getWeightOverview(session.user.id)
  return NextResponse.json({ overview, fetchedAt: new Date().toISOString() })
}
