import { macrosDailyActivityBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { upsertDailyActivity } from "@/lib/body/service";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosDailyActivityBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid activity", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(
    { activity: await upsertDailyActivity(session.user.id, parsed.data) },
    { status: 201 },
  );
}
