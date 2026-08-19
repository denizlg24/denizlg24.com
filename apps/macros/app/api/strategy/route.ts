import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { getActiveGoal, listGoalHistory } from "@/lib/goals/service"
import { getActivePlan } from "@/lib/plans/service"

export async function GET() {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const [plan, goal, history] = await Promise.all([
    getActivePlan(session.user.id),
    getActiveGoal(session.user.id),
    listGoalHistory(session.user.id),
  ])

  return NextResponse.json({ plan, goal, history })
}
