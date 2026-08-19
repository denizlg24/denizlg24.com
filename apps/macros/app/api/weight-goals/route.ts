import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { upsertGoalBodySchema } from "@/lib/goals/contracts"
import { createGoal, getActiveGoal, listGoalHistory } from "@/lib/goals/service"

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession()
  if (!session) return response
  const url = new URL(request.url)
  if (url.searchParams.get("history") === "true") {
    const history = await listGoalHistory(session.user.id)
    return NextResponse.json({ history })
  }
  const goal = await getActiveGoal(session.user.id)
  return NextResponse.json({ goal })
}

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const body = await request.json().catch(() => null)
  const parsed = upsertGoalBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid goal", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const goal = await createGoal(session.user.id, parsed.data)
  return NextResponse.json({ goal }, { status: 201 })
}
