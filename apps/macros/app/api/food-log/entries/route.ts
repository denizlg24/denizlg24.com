import { NextResponse } from "next/server"

import { getRequiredSession } from "@/lib/api/session"
import { logFoodBodySchema } from "@/lib/foods/contracts"
import { logExternalFood } from "@/lib/foods/service"

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession()

  if (!session) {
    return response
  }

  const body = await request.json().catch(() => null)
  const parsed = logFoodBodySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid food log entry", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { totals, ...entry } = await logExternalFood(
    session.user.id,
    parsed.data
  )

  return NextResponse.json({ entry, totals }, { status: 201 })
}
