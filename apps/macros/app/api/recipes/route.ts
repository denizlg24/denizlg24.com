import { NextResponse } from "next/server"

import { getRequiredSession } from "@/lib/api/session"
import { createRecipeBodySchema } from "@/lib/recipes/contracts"
import { createRecipeFromFoods, getUserRecipes } from "@/lib/recipes/service"

export async function GET() {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const items = await getUserRecipes(session.user.id)
  return NextResponse.json({ items, fetchedAt: new Date().toISOString() })
}

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const body = await request.json().catch(() => null)
  const parsed = createRecipeBodySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid recipe", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const recipe = await createRecipeFromFoods(session.user.id, parsed.data)
  return NextResponse.json(
    { recipe, fetchedAt: new Date().toISOString() },
    { status: 201 }
  )
}
