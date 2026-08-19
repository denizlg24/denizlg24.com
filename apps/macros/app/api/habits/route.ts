import { macrosHabitBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { createHabit } from "@/lib/body/service";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosHabitBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid habit", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(
    { habit: await createHabit(session.user.id, parsed.data) },
    { status: 201 },
  );
}
