import { NextResponse } from "next/server"

import { getRequiredSession } from "@/lib/api/session"
import { updateRecipeBodySchema } from "@/lib/recipes/contracts"
import {
  deleteRecipe,
  getRecipeDetail,
  updateRecipe,
} from "@/lib/recipes/service"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const { id } = await context.params

  try {
    const recipe = await getRecipeDetail(session.user.id, id)
    return NextResponse.json({ recipe, fetchedAt: new Date().toISOString() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Recipe not found" },
      { status: 404 }
    )
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const { id } = await context.params
  const body = await request.json().catch(() => null)
  const parsed = updateRecipeBodySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid recipe", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const recipe = await updateRecipe(session.user.id, id, parsed.data)
    return NextResponse.json({ recipe, fetchedAt: new Date().toISOString() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Recipe not found" },
      { status: 404 }
    )
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const { id } = await context.params

  try {
    await deleteRecipe(session.user.id, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Recipe not found" },
      { status: 404 }
    )
  }
}
