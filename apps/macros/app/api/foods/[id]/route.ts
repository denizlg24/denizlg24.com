import { NextResponse } from "next/server"
import { z } from "zod"

import { getRequiredSession } from "@/lib/api/session"
import { updateFoodBodySchema } from "@/lib/foods/contracts"
import {
  ensureExternalFoodSnapshot,
  getCustomFoodSnapshot,
  softDeleteCustomFood,
  toFoodSearchItem,
  updateCustomFood,
} from "@/lib/foods/service"
import { toNutritionSourceErrorResponse } from "../_lib/source-error-response"

const paramsSchema = z.object({ id: z.uuid() })

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { session, response } = await getRequiredSession()

  if (!session) {
    return response
  }

  const parsed = paramsSchema.safeParse(await context.params)

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid food id" }, { status: 400 })
  }

  try {
    const customFood = await getCustomFoodSnapshot(
      session.user.id,
      parsed.data.id
    )

    if (customFood) {
      return NextResponse.json({
        item: customFood.item,
        nutrition: customFood.nutrition,
        localFoodId: customFood.foodId,
        snapshotId: customFood.snapshotId,
        createdSnapshot: false,
        fetchedAt: new Date().toISOString(),
      })
    }

    const result = await ensureExternalFoodSnapshot(parsed.data.id)

    return NextResponse.json({
      item: toFoodSearchItem(result.summary),
      nutrition: result.nutrition,
      localFoodId: result.foodId,
      snapshotId: result.snapshotId,
      createdSnapshot: result.createdSnapshot,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    return toNutritionSourceErrorResponse(error)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { session, response } = await getRequiredSession()

  if (!session) {
    return response
  }

  const parsedParams = paramsSchema.safeParse(await context.params)

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid food id" }, { status: 400 })
  }

  const body: unknown = await request.json().catch(() => null)
  const parsedBody = updateFoodBodySchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid food payload", issues: parsedBody.error.issues },
      { status: 400 }
    )
  }

  let result: Awaited<ReturnType<typeof updateCustomFood>>
  try {
    result = await updateCustomFood(
      session.user.id,
      parsedParams.data.id,
      parsedBody.data
    )
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 })
  }

  if (!result) {
    return NextResponse.json({ error: "Food not found" }, { status: 404 })
  }

  return NextResponse.json({
    item: result.item,
    nutrition: result.nutrition,
    localFoodId: result.foodId,
    snapshotId: result.snapshotId,
    fetchedAt: new Date().toISOString(),
  })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { session, response } = await getRequiredSession()

  if (!session) {
    return response
  }

  const parsed = paramsSchema.safeParse(await context.params)

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid food id" }, { status: 400 })
  }

  let deleted: Awaited<ReturnType<typeof softDeleteCustomFood>>
  try {
    deleted = await softDeleteCustomFood(session.user.id, parsed.data.id)
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 })
  }

  if (!deleted) {
    return NextResponse.json({ error: "Food not found" }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
  })
}
