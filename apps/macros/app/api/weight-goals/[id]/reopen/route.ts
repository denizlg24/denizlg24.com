import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { NotFoundError, reopenGoal } from "@/lib/goals/service"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, response } = await getRequiredSession()
  if (!session) return response
  const { id } = await params
  try {
    const goal = await reopenGoal(session.user.id, id)
    return NextResponse.json({ goal })
  } catch (err) {
    console.error("Error reopening goal:", err)
    const isNotFound = err instanceof NotFoundError
    const status = isNotFound ? 404 : 500
    const message = isNotFound ? "Goal not found" : "Internal server error"
    return NextResponse.json({ error: message }, { status })
  }
}
