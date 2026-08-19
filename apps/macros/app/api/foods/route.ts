import { NextResponse } from "next/server"

import { getRequiredSession } from "@/lib/api/session"
import { createFoodBodySchema } from "@/lib/foods/contracts"
import { createCustomFood, getUserCustomFoods } from "@/lib/foods/service"

export async function GET() {
  const { session, response } = await getRequiredSession()

  if (!session) {
    return response
  }

  const items = await getUserCustomFoods(session.user.id)

  return NextResponse.json({
    items,
    fetchedAt: new Date().toISOString(),
  })
}

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession()

  if (!session) {
    return response
  }

  const body: unknown = await request.json().catch(() => null)
  const parsed = createFoodBodySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid food payload", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const result = await createCustomFood(session.user.id, parsed.data)

  return NextResponse.json(
    {
      clientMutationId: parsed.data.clientMutationId,
      item: result.item,
      nutrition: result.nutrition,
      localFoodId: result.foodId,
      snapshotId: result.snapshotId,
      fetchedAt: new Date().toISOString(),
    },
    { status: 201 }
  )
}
