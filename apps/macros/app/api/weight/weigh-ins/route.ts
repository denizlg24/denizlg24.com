import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { upsertWeighInBodySchema } from "@/lib/weights/contracts"
import { upsertWeighIn } from "@/lib/weights/service"

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const body = await request.json().catch(() => null)
  const parsed = upsertWeighInBodySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid weigh-in", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const entry = await upsertWeighIn(session.user.id, parsed.data)
  return NextResponse.json({ entry }, { status: 201 })
}
