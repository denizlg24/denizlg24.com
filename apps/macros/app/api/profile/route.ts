import {
  type MacrosProfileResponse,
  macrosSexSchema,
} from "@repo/schemas/macros";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db/connection";
import { userProfiles } from "@/db/schema";
import { getRequiredSession } from "@/lib/api/session";

export async function GET() {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
    columns: {
      timezone: true,
      weightUnit: true,
      energyUnit: true,
      caloriePreference: true,
      onboardingCompletedAt: true,
      sex: true,
      birthDate: true,
    },
  });

  return NextResponse.json({
    profile: {
      userId: session.user.id,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      onboardingCompleted: Boolean(profile?.onboardingCompletedAt),
      timezone: profile?.timezone ?? "UTC",
      weightUnit: profile?.weightUnit === "lb" ? "lb" : "kg",
      energyUnit: profile?.energyUnit === "kj" ? "kj" : "kcal",
      caloriePreference: profile?.caloriePreference ?? "consumed",
      sex: macrosSexSchema.safeParse(profile?.sex).data ?? null,
      birthDate: profile?.birthDate ?? null,
    },
  } satisfies MacrosProfileResponse);
}
