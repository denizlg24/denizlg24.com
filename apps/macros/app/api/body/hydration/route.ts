import { macrosHydrationBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { addHydration } from "@/lib/body/service";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosHydrationBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid hydration", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(
    { hydration: await addHydration(session.user.id, parsed.data) },
    { status: 201 },
  );
}
