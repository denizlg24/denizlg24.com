import {
  macrosBulkDeleteEntriesBodySchema,
  macrosMoveEntriesBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import {
  bulkDeleteLogEntries,
  moveLogEntries,
} from "@/lib/foods/entry-acceleration";

export async function PATCH(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosMoveEntriesBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid move request", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(await moveLogEntries(session.user.id, parsed.data));
}

export async function DELETE(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosBulkDeleteEntriesBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid delete request", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(
    await bulkDeleteLogEntries(session.user.id, parsed.data.entryIds),
  );
}
