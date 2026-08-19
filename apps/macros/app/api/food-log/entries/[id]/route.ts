import { NextResponse } from "next/server"

import { getRequiredSession } from "@/lib/api/session"
import { deleteFoodLogEntry } from "@/lib/foods/delete-entry"

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { session, response } = await getRequiredSession()
  if (!session) return response

  const { id } = await context.params
  const result = await deleteFoodLogEntry(session.user.id, id)
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ success: true, logDate: result.logDate })
}
