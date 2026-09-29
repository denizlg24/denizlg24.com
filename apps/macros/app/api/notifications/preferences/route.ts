import {
  type MacrosNotificationPreferencesResponse,
  macrosUpdateNotificationPreferencesBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/api/session";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/push/devices";

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const preferences = await getNotificationPreferences(session.user.id);
  return NextResponse.json({
    preferences,
  } satisfies MacrosNotificationPreferencesResponse);
}

export async function PATCH(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const parsed = macrosUpdateNotificationPreferencesBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid notification preferences",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const preferences = await updateNotificationPreferences(
    session.user.id,
    parsed.data,
  );
  return NextResponse.json({
    preferences,
  } satisfies MacrosNotificationPreferencesResponse);
}
