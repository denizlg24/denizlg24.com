import { macrosUpdateLogEntryBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { deleteFoodLogEntry } from "@/lib/foods/delete-entry";
import { updateLogEntryServing } from "@/lib/foods/entry-acceleration";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosUpdateLogEntryBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid serving", issues: parsed.error.issues },
      { status: 400 },
    );
  const { id } = await context.params;
  const entry = await updateLogEntryServing(session.user.id, id, parsed.data);
  return entry
    ? NextResponse.json({ entry })
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const { id } = await context.params;
  const result = await deleteFoodLogEntry(session.user.id, id);
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, logDate: result.logDate });
}
