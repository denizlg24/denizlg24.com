import { NextResponse } from "next/server"

import { getRequiredSession } from "@/lib/api/session"
import { foodRevalidateBodySchema } from "@/lib/foods/contracts"
import {
  ensureExternalFoodSnapshot,
  toFoodSearchItem,
} from "@/lib/foods/service"
import { getNutritionSourceStatus } from "@/lib/foods/source"

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession()

  if (!session) {
    return response
  }

  const body = await request.json().catch(() => null)
  const parsed = foodRevalidateBodySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid revalidation request", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const settledResults = await Promise.all(
    parsed.data.itemIds.map(async (itemId) => {
      try {
        const result = await ensureExternalFoodSnapshot(itemId)
        return {
          ok: true as const,
          value: {
            item: toFoodSearchItem(result.summary),
            localFoodId: result.foodId,
            snapshotId: result.snapshotId,
            createdSnapshot: result.createdSnapshot,
          },
        }
      } catch (error) {
        return {
          ok: false as const,
          value: {
            itemId,
            status: getNutritionSourceStatus(error),
          },
        }
      }
    })
  )

  const results = settledResults
    .filter((result) => result.ok)
    .map((result) => result.value)
  const failures = settledResults
    .filter((result) => !result.ok)
    .map((result) => result.value)

  return NextResponse.json({
    items: results,
    failures,
    fetchedAt: new Date().toISOString(),
  })
}
