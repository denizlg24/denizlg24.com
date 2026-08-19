import { macrosHabitCompletionBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { setHabitCompletion } from "@/lib/body/service";

export async function PUT(
  request: Request,
  context: RouteContext<"/api/habits/[id]/completion">,
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosHabitCompletionBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid completion", issues: parsed.error.issues },
      { status: 400 },
    );
  const { id } = await context.params;
  const updated = await setHabitCompletion(session.user.id, id, parsed.data);
  return updated
    ? NextResponse.json({ updated: true })
    : NextResponse.json({ error: "Habit not found" }, { status: 404 });
}
