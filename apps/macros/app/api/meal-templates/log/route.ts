import { macrosLogMealTemplateBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { logMealTemplate } from "@/lib/foods/entry-acceleration";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosLogMealTemplateBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid template log", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(
    await logMealTemplate(session.user.id, parsed.data),
    { status: 201 },
  );
}
