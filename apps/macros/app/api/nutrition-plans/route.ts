import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { upsertPlanBodySchema } from "@/lib/plans/contracts"
import { createPlan, getActivePlan } from "@/lib/plans/service"

export async function GET() {
  const { session, response } = await getRequiredSession()
  if (!session) return response
  const plan = await getActivePlan(session.user.id)
  return NextResponse.json({ plan })
}

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const body = await request.json().catch(() => null)
  const parsed = upsertPlanBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid plan", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const plan = await createPlan(session.user.id, parsed.data)
  return NextResponse.json({ plan }, { status: 201 })
}
