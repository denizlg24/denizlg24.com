import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { upsertGoalBodySchema } from "@/lib/goals/contracts"
import { updateActiveGoal } from "@/lib/goals/service"

export async function PATCH(request: Request) {
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

  const goal = await updateActiveGoal(session.user.id, parsed.data)
  return NextResponse.json({ goal })
}
