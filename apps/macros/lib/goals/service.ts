import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db/connection"
import { userProfiles, weighIns, weightGoals } from "@/db/schema"
import type {
  ActiveGoal,
  GoalHistoryEntry,
  GoalOutcome,
  UpsertGoalBody,
} from "./contracts"

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotFoundError"
  }
}

function parseNumeric(value: string | null): number | null {
  if (value == null) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toNumeric(value: number | null | undefined): string | null {
  return value == null ? null : value.toString()
}

function todayIsoInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date()
  )
}

async function getLatestWeightKg(userId: string): Promise<number | null> {
  const row = await db.query.weighIns.findFirst({
    where: eq(weighIns.userId, userId),
    orderBy: desc(weighIns.measuredAt),
    columns: { weightKg: true },
  })
  return row ? parseNumeric(row.weightKg) : null
}

function computeOutcome(
  startWeight: number | null,
  endWeight: number | null
): GoalOutcome | null {
  if (startWeight == null || endWeight == null) return null
  const delta = endWeight - startWeight
  if (Math.abs(delta) < 0.05) return "maintain"
  return delta < 0 ? "loss" : "gain"
}

function computeAchieved(
  goalType: "lose" | "maintain" | "gain",
  startWeight: number | null,
  endWeight: number | null,
  targetWeight: number | null
): boolean | null {
  if (endWeight == null) return null
  if (goalType === "maintain") {
    if (startWeight == null) return null
    return Math.abs(endWeight - startWeight) <= 1.0
  }
  if (targetWeight == null) return null
  if (goalType === "lose") return endWeight <= targetWeight
  return endWeight >= targetWeight
}

export async function getActiveGoal(
  userId: string
): Promise<ActiveGoal | null> {
  const row = await db.query.weightGoals.findFirst({
    where: and(
      eq(weightGoals.userId, userId),
      eq(weightGoals.status, "active")
    ),
  })
  if (!row) return null
  return {
    id: row.id,
    goalType: row.goalType,
    startDate: row.startDate,
    startWeightKg: parseNumeric(row.startWeightKg),
    targetWeightKg: parseNumeric(row.targetWeightKg),
    targetDate: row.targetDate,
    weeklyRateKg: parseNumeric(row.weeklyRateKg),
  }
}

export async function listGoalHistory(
  userId: string
): Promise<GoalHistoryEntry[]> {
  const rows = await db.query.weightGoals.findMany({
    where: eq(weightGoals.userId, userId),
    orderBy: desc(weightGoals.startDate),
  })
  return rows.map((row) => ({
    id: row.id,
    goalType: row.goalType,
    startDate: row.startDate,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    endDate: row.targetDate ?? null,
    startWeightKg: parseNumeric(row.startWeightKg),
    endWeightKg: parseNumeric(row.endWeightKg),
    targetWeightKg: parseNumeric(row.targetWeightKg),
    outcome: row.outcome,
    achieved: row.achieved,
    isActive: row.status === "active",
  }))
}

export async function createGoal(
  userId: string,
  body: UpsertGoalBody
): Promise<ActiveGoal> {
  const now = new Date()
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  })
  const today = todayIsoInTimezone(profile?.timezone ?? "UTC")

  const startWeight =
    body.startWeightKg ?? (await getLatestWeightKg(userId)) ?? null

  const newId = await db.transaction(async (tx) => {
    const current = await tx.query.weightGoals.findFirst({
      where: and(
        eq(weightGoals.userId, userId),
        eq(weightGoals.status, "active")
      ),
    })
    if (current) {
      const endWeight = startWeight
      const outcome = computeOutcome(
        parseNumeric(current.startWeightKg),
        endWeight
      )
      const achieved = computeAchieved(
        current.goalType,
        parseNumeric(current.startWeightKg),
        endWeight,
        parseNumeric(current.targetWeightKg)
      )
      await tx
        .update(weightGoals)
        .set({
          status: "archived",
          closedAt: now,
          endWeightKg: toNumeric(endWeight),
          outcome,
          achieved,
          updatedAt: now,
        })
        .where(eq(weightGoals.id, current.id))
    }

    const [inserted] = await tx
      .insert(weightGoals)
      .values({
        userId,
        goalType: body.goalType,
        startDate: today,
        startWeightKg: toNumeric(startWeight),
        targetWeightKg: toNumeric(body.targetWeightKg ?? null),
        targetDate: body.targetDate ?? null,
        weeklyRateKg: toNumeric(body.weeklyRateKg ?? null),
      })
      .returning({ id: weightGoals.id })

    return inserted.id
  })

  const detail = await getActiveGoal(userId)
  if (!detail || detail.id !== newId) {
    throw new Error("Failed to load newly created goal")
  }
  return detail
}

export async function updateActiveGoal(
  userId: string,
  body: UpsertGoalBody
): Promise<ActiveGoal> {
  const existing = await getActiveGoal(userId)
  if (!existing) {
    return createGoal(userId, body)
  }
  const now = new Date()
  const updates: Record<string, unknown> = {
    goalType: body.goalType,
    updatedAt: now,
  }
  if (body.startWeightKg != null) {
    updates.startWeightKg = toNumeric(body.startWeightKg)
  }
  if (body.hasOwnProperty("targetWeightKg")) {
    updates.targetWeightKg = toNumeric(body.targetWeightKg ?? null)
  }
  if (body.hasOwnProperty("targetDate")) {
    updates.targetDate = body.targetDate ?? null
  }
  if (body.hasOwnProperty("weeklyRateKg")) {
    updates.weeklyRateKg = toNumeric(body.weeklyRateKg ?? null)
  }
  await db
    .update(weightGoals)
    .set(updates)
    .where(eq(weightGoals.id, existing.id))

  const detail = await getActiveGoal(userId)
  if (!detail) throw new Error("Failed to reload goal")
  return detail
}

export async function reopenGoal(
  userId: string,
  goalId: string
): Promise<ActiveGoal> {
  const now = new Date()
  await db.transaction(async (tx) => {
    const target = await tx.query.weightGoals.findFirst({
      where: and(eq(weightGoals.id, goalId), eq(weightGoals.userId, userId)),
    })
    if (!target) throw new NotFoundError("Goal not found")
    if (target.status === "active") return

    const current = await tx.query.weightGoals.findFirst({
      where: and(
        eq(weightGoals.userId, userId),
        eq(weightGoals.status, "active")
      ),
    })
    if (current) {
      const endWeight = await (async () => {
        const latest = await tx.query.weighIns.findFirst({
          where: eq(weighIns.userId, userId),
          orderBy: desc(weighIns.measuredAt),
          columns: { weightKg: true },
        })
        return latest ? parseNumeric(latest.weightKg) : null
      })()
      const outcome = computeOutcome(
        parseNumeric(current.startWeightKg),
        endWeight
      )
      const achieved = computeAchieved(
        current.goalType,
        parseNumeric(current.startWeightKg),
        endWeight,
        parseNumeric(current.targetWeightKg)
      )
      await tx
        .update(weightGoals)
        .set({
          status: "archived",
          closedAt: now,
          endWeightKg: toNumeric(endWeight),
          outcome,
          achieved,
          updatedAt: now,
        })
        .where(eq(weightGoals.id, current.id))
    }

    await tx
      .update(weightGoals)
      .set({
        status: "active",
        closedAt: null,
        endWeightKg: null,
        outcome: null,
        achieved: null,
        updatedAt: now,
      })
      .where(eq(weightGoals.id, goalId))
  })

  const detail = await getActiveGoal(userId)
  if (!detail) throw new Error("Failed to reload reopened goal")
  return detail
}
