import { NextResponse } from "next/server"

import { getRequiredSession } from "@/lib/api/session"
import { logRecipeBodySchema } from "@/lib/recipes/contracts"
import { logRecipe } from "@/lib/recipes/service"

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const body = await request.json().catch(() => null)
  const parsed = logRecipeBodySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid recipe log entry", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { totals, ...entry } = await logRecipe(session.user.id, parsed.data)
  return NextResponse.json({ entry, totals }, { status: 201 })
}
