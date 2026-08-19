import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { getDashboardData } from "@/lib/queries/dashboard"

export async function GET() {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const dashboard = await getDashboardData(session.user.id)
  return NextResponse.json({ dashboard, fetchedAt: new Date().toISOString() })
}
