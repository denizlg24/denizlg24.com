import { macrosBodyMeasurementBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { upsertBodyMeasurement } from "@/lib/body/service";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = macrosBodyMeasurementBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid measurement", issues: parsed.error.issues },
      { status: 400 },
    );
  return NextResponse.json(
    { measurement: await upsertBodyMeasurement(session.user.id, parsed.data) },
    { status: 201 },
  );
}
