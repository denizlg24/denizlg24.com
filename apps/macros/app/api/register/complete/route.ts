import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/connection"
import {
  nutritionPlanDays,
  nutritionPlans,
  userProfiles,
  weighIns,
  weightGoals,
} from "@/db/schema"
import { auth } from "@/lib/auth"
import { planDayInputSchema } from "@/lib/plans/contracts"

const dateSchema = z.iso.date()

const completeRegistrationSchema = z.object({
  profile: z.object({
    timezone: z.string().min(1).default("UTC"),
    birthDate: dateSchema.optional(),
    ageYears: z.number().int().min(13).max(120).optional(),
    heightCm: z.number().min(50).max(260).optional(),
    sex: z.enum(["female", "male", "other", "prefer_not_to_say"]).optional(),
    activityLevel: z
      .enum(["sedentary", "light", "moderate", "active", "very_active"])
      .optional(),
    weightUnit: z.enum(["kg", "lb"]).default("kg"),
    energyUnit: z.enum(["kcal", "kj"]).default("kcal"),
  }),
  metrics: z.object({
    measuredAt: z.iso.datetime({ offset: true }).optional(),
    logDate: dateSchema.optional(),
    weightKg: z.number().min(20).max(500),
  }),
  weightGoal: z.object({
    goalType: z.enum(["lose", "maintain", "gain"]),
    targetWeightKg: z.number().min(20).max(500).optional(),
    targetDate: dateSchema.optional(),
    weeklyRateKg: z.number().min(0).max(2).optional(),
  }),
  nutritionPlan: z.object({
    name: z.string().min(1).max(120).default("Coached Program"),
    days: z.array(planDayInputSchema).length(7),
  }),
})

function getTodayInTimezone(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now)
}

function getBirthDateFromAge(ageYears: number, now: Date) {
  const birthDate = new Date(now)
  birthDate.setUTCFullYear(birthDate.getUTCFullYear() - ageYears)
  return birthDate.toISOString().slice(0, 10)
}

function getProfileBirthDate(
  profile: z.infer<typeof completeRegistrationSchema>["profile"],
  now: Date
) {
  if (profile.birthDate) return profile.birthDate
  if (profile.ageYears === undefined) return undefined
  return getBirthDateFromAge(profile.ageYears, now)
}

function toNumericString(value: number | undefined | null) {
  return value == null ? null : value.toString()
}

function averageOfDays(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((a, b) => a + b, 0)
  return Math.round((sum / values.length) * 100) / 100
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!session.user.emailVerified) {
    return NextResponse.json(
      { error: "Email is not verified" },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => null)
  const parsed = completeRegistrationSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid registration profile", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { profile, metrics, weightGoal, nutritionPlan } = parsed.data

  const existingProfile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
    columns: { onboardingCompletedAt: true },
  })

  if (
    existingProfile?.onboardingCompletedAt !== null &&
    existingProfile?.onboardingCompletedAt !== undefined
  ) {
    return NextResponse.json(
      { error: "Onboarding already completed" },
      { status: 409 }
    )
  }

  const now = new Date()
  const today = getTodayInTimezone(now, profile.timezone)
  const logDate = metrics.logDate ?? today
  const measuredAt = metrics.measuredAt ? new Date(metrics.measuredAt) : now
  const birthDate = getProfileBirthDate(profile, now)

  const calorieAvg = averageOfDays(
    nutritionPlan.days.map((d) => d.calorieTarget)
  )
  const proteinAvg = averageOfDays(
    nutritionPlan.days.map((d) => d.proteinTarget)
  )
  const carbsAvg = averageOfDays(nutritionPlan.days.map((d) => d.carbsTarget))
  const fatAvg = averageOfDays(nutritionPlan.days.map((d) => d.fatTarget))

  await db.transaction(async (tx) => {
    await tx
      .insert(userProfiles)
      .values({
        userId: session.user.id,
        timezone: profile.timezone,
        heightCm: toNumericString(profile.heightCm),
        birthDate,
        sex: profile.sex,
        activityLevel: profile.activityLevel,
        weightUnit: profile.weightUnit,
        energyUnit: profile.energyUnit,
        onboardingCompletedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          timezone: profile.timezone,
          heightCm: toNumericString(profile.heightCm),
          birthDate,
          sex: profile.sex,
          activityLevel: profile.activityLevel,
          weightUnit: profile.weightUnit,
          energyUnit: profile.energyUnit,
          onboardingCompletedAt: now,
          updatedAt: now,
        },
      })

    await tx
      .update(weightGoals)
      .set({ status: "archived", updatedAt: now })
      .where(eq(weightGoals.userId, session.user.id))

    await tx.insert(weightGoals).values({
      userId: session.user.id,
      goalType: weightGoal.goalType,
      startDate: today,
      startWeightKg: metrics.weightKg.toString(),
      targetWeightKg: toNumericString(weightGoal.targetWeightKg),
      targetDate: weightGoal.targetDate,
      weeklyRateKg: toNumericString(weightGoal.weeklyRateKg),
    })

    await tx
      .insert(weighIns)
      .values({
        userId: session.user.id,
        logDate,
        timezoneAtLog: profile.timezone,
        measuredAt,
        weightKg: metrics.weightKg.toString(),
      })
      .onConflictDoUpdate({
        target: [weighIns.userId, weighIns.logDate],
        set: {
          measuredAt,
          weightKg: metrics.weightKg.toString(),
          updatedAt: now,
        },
      })

    const existingActivePlan = await tx.query.nutritionPlans.findFirst({
      where: and(
        eq(nutritionPlans.userId, session.user.id),
        eq(nutritionPlans.status, "active")
      ),
    })

    let planId: string
    if (existingActivePlan) {
      planId = existingActivePlan.id
    } else {
      await tx
        .update(nutritionPlans)
        .set({ status: "archived", updatedAt: now })
        .where(eq(nutritionPlans.userId, session.user.id))

      const [insertedPlan] = await tx
        .insert(nutritionPlans)
        .values({
          userId: session.user.id,
          name: nutritionPlan.name,
          goalType: weightGoal.goalType,
          startDate: today,
          calorieTarget: toNumericString(calorieAvg),
          proteinTarget: toNumericString(proteinAvg),
          carbsTarget: toNumericString(carbsAvg),
          fatTarget: toNumericString(fatAvg),
        })
        .returning({ id: nutritionPlans.id })

      planId = insertedPlan.id

      await tx.insert(nutritionPlanDays).values(
        nutritionPlan.days.map((d) => ({
          planId: planId,
          weekday: d.weekday,
          calorieTarget: toNumericString(d.calorieTarget),
          proteinTarget: toNumericString(d.proteinTarget),
          carbsTarget: toNumericString(d.carbsTarget),
          fatTarget: toNumericString(d.fatTarget),
        }))
      )
    }
  })

  return NextResponse.json({ status: "completed" })
}
