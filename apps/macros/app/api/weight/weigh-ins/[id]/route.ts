import { NextResponse } from "next/server"
import { getRequiredSession } from "@/lib/api/session"
import { deleteWeighIn } from "@/lib/weights/service"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const { id } = await params
  const deleted = await deleteWeighIn(session.user.id, id)
  if (!deleted) {
    return NextResponse.json({ error: "Weigh-in not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
