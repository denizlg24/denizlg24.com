import type { MacrosOkResponse } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequiredSession } from "@/lib/api/session";
import { archiveMealTemplate } from "@/lib/foods/entry-acceleration";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/meal-templates/[id]">,
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  return (await archiveMealTemplate(session.user.id, id.data))
    ? NextResponse.json({ ok: true } satisfies MacrosOkResponse)
    : NextResponse.json({ error: "Meal not found" }, { status: 404 });
}
