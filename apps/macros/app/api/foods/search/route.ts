import { NextResponse } from "next/server"

import { getRequiredSession } from "@/lib/api/session"
import { foodSearchParamsSchema } from "@/lib/foods/contracts"
import { searchUserCustomFoods, toFoodSearchItem } from "@/lib/foods/service"
import { searchNutritionFoods } from "@/lib/foods/source"
import { toNutritionSourceErrorResponse } from "../_lib/source-error-response"

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession()

  if (!session) {
    return response
  }

  const url = new URL(request.url)
  const parsed = foodSearchParamsSchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    brand: url.searchParams.get("brand") ?? undefined,
    lang: url.searchParams.get("lang") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    minScore: url.searchParams.get("minScore") ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid food search", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const [userItems, sourceItems] = await Promise.all([
      searchUserCustomFoods(
        session.user.id,
        parsed.data.q,
        parsed.data.brand,
        parsed.data.limit
      ),
      searchNutritionFoods(parsed.data),
    ])
    const userItemIds = new Set(userItems.map((item) => item.id))

    return NextResponse.json({
      items: [
        ...userItems,
        ...sourceItems
          .map(toFoodSearchItem)
          .filter((item) => !userItemIds.has(item.id)),
      ].slice(0, parsed.data.limit),
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    return toNutritionSourceErrorResponse(error)
  }
}
