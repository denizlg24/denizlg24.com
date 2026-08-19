import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequiredSession } from "@/lib/api/session";
import { duplicateLogEntry } from "@/lib/foods/entry-acceleration";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/food-log/entries/[id]/duplicate">,
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = z.uuid().safeParse((await context.params).id);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid entry id" }, { status: 400 });
  const entryId = await duplicateLogEntry(session.user.id, parsed.data);
  return entryId
    ? NextResponse.json({ entryId }, { status: 201 })
    : NextResponse.json({ error: "Entry not found" }, { status: 404 });
}
