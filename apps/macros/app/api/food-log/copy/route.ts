import { macrosCopyLogBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { copyLoggedMeal } from "@/lib/foods/entry-acceleration";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosCopyLogBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid copy request", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(await copyLoggedMeal(session.user.id, parsed.data), {
    status: 201,
  });
}
