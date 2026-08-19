import { macrosCreateMealTemplateBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import {
  createMealTemplate,
  listMealTemplates,
} from "@/lib/foods/entry-acceleration";

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  return NextResponse.json({ items: await listMealTemplates(session.user.id) });
}

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosCreateMealTemplateBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid template", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(
    { template: await createMealTemplate(session.user.id, parsed.data) },
    { status: 201 },
  );
}
