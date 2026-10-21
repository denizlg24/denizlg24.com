import { macrosFoodIdParamsSchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { removePantryItem } from "@/lib/pantry/service";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosFoodIdParamsSchema.safeParse(await context.params);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid pantry item" }, { status: 400 });
  if (!(await removePantryItem(session.user.id, parsed.data.id)))
    return NextResponse.json(
      { error: "Pantry item not found" },
      { status: 404 },
    );
  return NextResponse.json({ ok: true });
}
