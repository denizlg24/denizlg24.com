import {
  type MacrosHabitResponse,
  type MacrosOkResponse,
  macrosUpdateHabitBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { archiveHabit, updateHabit } from "@/lib/body/service";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/habits/[id]">,
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosUpdateHabitBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid habit", issues: parsed.error.issues },
      { status: 400 },
    );
  const { id } = await context.params;
  const habit = await updateHabit(session.user.id, id, parsed.data);
  return habit
    ? NextResponse.json({ habit } satisfies MacrosHabitResponse)
    : NextResponse.json({ error: "Habit not found" }, { status: 404 });
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/habits/[id]">,
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const { id } = await context.params;
  return (await archiveHabit(session.user.id, id))
    ? NextResponse.json({ ok: true } satisfies MacrosOkResponse)
    : NextResponse.json({ error: "Habit not found" }, { status: 404 });
}
