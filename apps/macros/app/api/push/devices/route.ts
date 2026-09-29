import {
  type MacrosOkResponse,
  type MacrosPushDeviceResponse,
  macrosRegisterPushDeviceBodySchema,
  macrosUnregisterPushDeviceBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import { registerPushDevice, unregisterPushDevice } from "@/lib/push/devices";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const parsed = macrosRegisterPushDeviceBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid push device", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const device = await registerPushDevice(session.user.id, parsed.data);
  return NextResponse.json({ device } satisfies MacrosPushDeviceResponse);
}

export async function DELETE(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const parsed = macrosUnregisterPushDeviceBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid push device", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await unregisterPushDevice(session.user.id, parsed.data.token);
  return NextResponse.json({ ok: true } satisfies MacrosOkResponse);
}
