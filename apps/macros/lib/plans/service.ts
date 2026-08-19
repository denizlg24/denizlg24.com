import { and, asc, eq } from "drizzle-orm"
import { db } from "@/db/connection"
import { nutritionPlanDays, nutritionPlans, userProfiles } from "@/db/schema"
import type { PlanDetail, UpsertPlanBody } from "./contracts"

function toNumeric(value: number | null | undefined): string | null {
  return value == null ? null : value.toString()
}

function parseNumeric(value: string | null): number | null {
  if (value == null) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function averageOfDays(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((a, b) => a + b, 0)
  return Math.round((sum / values.length) * 100) / 100
}

function todayIsoInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date()
  )
}

export async function getActivePlan(
  userId: string
): Promise<PlanDetail | null> {
  const plan = await db.query.nutritionPlans.findFirst({
    where: and(
      eq(nutritionPlans.userId, userId),
      eq(nutritionPlans.status, "active")
    ),
  })
  if (!plan) return null
  const days = await db
    .select()
    .from(nutritionPlanDays)
    .where(eq(nutritionPlanDays.planId, plan.id))
    .orderBy(asc(nutritionPlanDays.weekday))

  return {
    id: plan.id,
    name: plan.name,
    goalType: plan.goalType,
    startDate: plan.startDate,
    baseCalorieTarget: parseNumeric(plan.calorieTarget),
    baseProteinTarget: parseNumeric(plan.proteinTarget),
    baseCarbsTarget: parseNumeric(plan.carbsTarget),
    baseFatTarget: parseNumeric(plan.fatTarget),
    days: days.map((d) => ({
      weekday: d.weekday,
      calorieTarget: parseNumeric(d.calorieTarget),
      proteinTarget: parseNumeric(d.proteinTarget),
      carbsTarget: parseNumeric(d.carbsTarget),
      fatTarget: parseNumeric(d.fatTarget),
    })),
  }
}

export async function createPlan(
  userId: string,
  body: UpsertPlanBody
): Promise<PlanDetail> {
  const now = new Date()
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  })
  const today = todayIsoInTimezone(profile?.timezone ?? "UTC")

  const calorieAvg = averageOfDays(body.days.map((d) => d.calorieTarget))
  const proteinAvg = averageOfDays(body.days.map((d) => d.proteinTarget))
  const carbsAvg = averageOfDays(body.days.map((d) => d.carbsTarget))
  const fatAvg = averageOfDays(body.days.map((d) => d.fatTarget))

  const planId = await db.transaction(async (tx) => {
    if (body.activityLevel) {
      await tx
        .update(userProfiles)
        .set({ activityLevel: body.activityLevel, updatedAt: now })
        .where(eq(userProfiles.userId, userId))
    }

    await tx
      .update(nutritionPlans)
      .set({ status: "archived", endDate: today, updatedAt: now })
      .where(
        and(
          eq(nutritionPlans.userId, userId),
          eq(nutritionPlans.status, "active")
        )
      )

    const [inserted] = await tx
      .insert(nutritionPlans)
      .values({
        userId,
        name: body.name ?? "Coached Program",
        goalType: body.goalType,
        startDate: today,
        calorieTarget: toNumeric(calorieAvg),
        proteinTarget: toNumeric(proteinAvg),
        carbsTarget: toNumeric(carbsAvg),
        fatTarget: toNumeric(fatAvg),
      })
      .returning({ id: nutritionPlans.id })

    await tx.insert(nutritionPlanDays).values(
      body.days.map((d) => ({
        planId: inserted.id,
        weekday: d.weekday,
        calorieTarget: toNumeric(d.calorieTarget),
        proteinTarget: toNumeric(d.proteinTarget),
        carbsTarget: toNumeric(d.carbsTarget),
        fatTarget: toNumeric(d.fatTarget),
      }))
    )

    return inserted.id
  })

  const detail = await getActivePlan(userId)
  if (!detail || detail.id !== planId) {
    throw new Error("Failed to load newly created plan")
  }
  return detail
}

export async function updateActivePlan(
  userId: string,
  body: UpsertPlanBody
): Promise<PlanDetail> {
  const existing = await getActivePlan(userId)
  if (!existing) {
    return createPlan(userId, body)
  }
  const now = new Date()
  const calorieAvg = averageOfDays(body.days.map((d) => d.calorieTarget))
  const proteinAvg = averageOfDays(body.days.map((d) => d.proteinTarget))
  const carbsAvg = averageOfDays(body.days.map((d) => d.carbsTarget))
  const fatAvg = averageOfDays(body.days.map((d) => d.fatTarget))

  await db.transaction(async (tx) => {
    if (body.activityLevel) {
      await tx
        .update(userProfiles)
        .set({ activityLevel: body.activityLevel, updatedAt: now })
        .where(eq(userProfiles.userId, userId))
    }

    await tx
      .update(nutritionPlans)
      .set({
        name: body.name ?? existing.name,
        goalType: body.goalType,
        calorieTarget: toNumeric(calorieAvg),
        proteinTarget: toNumeric(proteinAvg),
        carbsTarget: toNumeric(carbsAvg),
        fatTarget: toNumeric(fatAvg),
        updatedAt: now,
      })
      .where(eq(nutritionPlans.id, existing.id))

    await tx
      .delete(nutritionPlanDays)
      .where(eq(nutritionPlanDays.planId, existing.id))

    await tx.insert(nutritionPlanDays).values(
      body.days.map((d) => ({
        planId: existing.id,
        weekday: d.weekday,
        calorieTarget: toNumeric(d.calorieTarget),
        proteinTarget: toNumeric(d.proteinTarget),
        carbsTarget: toNumeric(d.carbsTarget),
        fatTarget: toNumeric(d.fatTarget),
      }))
    )
  })

  const detail = await getActivePlan(userId)
  if (!detail) throw new Error("Failed to reload plan")
  return detail
}
