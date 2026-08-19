import {
  type MacrosCalorieCycling,
  type MacrosPlanReason,
  type MacrosProgram,
  type MacrosTargetIssue,
  type MacrosUpsertProgramBody,
  macrosCalorieCyclingSchema,
} from "@repo/schemas/macros";
import { and, desc, eq, lte, ne } from "drizzle-orm";
import { db } from "@/db/connection";
import {
  energyExpenditureEstimates,
  nutritionPlanDays,
  nutritionPlans,
  nutritionPrograms,
  userProfiles,
  weightGoals,
  weightTrendPoints,
} from "@/db/schema";
import { toIsoDate } from "@/lib/weights/date-utils";
import { calculateExpenditurePrior } from "@/lib/weights/expenditure";
import { buildCycledTargets, calculateDynamicTargets } from "./target-engine";

const TARGET_CHANGE_THRESHOLD_KCAL = 25;

function numberOrNull(value: string | null): number | null {
  return value == null ? null : Number(value);
}

function dateBefore(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function ageOnDate(birthDate: string | null, date: string): number | null {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  const current = new Date(`${date}T00:00:00.000Z`);
  let age = current.getUTCFullYear() - birth.getUTCFullYear();
  if (
    current.getUTCMonth() < birth.getUTCMonth() ||
    (current.getUTCMonth() === birth.getUTCMonth() &&
      current.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function activityMultiplier(value: string | null): number {
  switch (value) {
    case "sedentary":
      return 1.2;
    case "light":
      return 1.375;
    case "moderate":
      return 1.55;
    case "active":
      return 1.725;
    case "very_active":
      return 1.9;
    default:
      return 1.4;
  }
}

function mapProgram(row: typeof nutritionPrograms.$inferSelect): MacrosProgram {
  return {
    id: row.id,
    userId: row.userId,
    activeWeightGoalId: row.activeWeightGoalId,
    goalType: row.goalType,
    proteinGramsPerKg: Number(row.proteinGramsPerKg),
    fatGramsPerKg: numberOrNull(row.fatGramsPerKg),
    fatPercent: numberOrNull(row.fatPercent),
    distributionProfile: row.distributionProfile,
    calorieCycling: macrosCalorieCyclingSchema.parse(row.calorieCycling),
    checkInWeekday: row.checkInWeekday,
    mode: row.mode,
    dietPhase: row.dietPhase,
    manualCalorieTarget: numberOrNull(row.manualCalorieTarget),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapIssue(row: typeof nutritionPlans.$inferSelect): MacrosTargetIssue {
  return {
    id: row.id,
    programId: row.programId,
    status: row.status,
    reason: row.reason,
    effectiveFrom: row.effectiveFrom ?? row.startDate,
    effectiveTo: row.effectiveTo ?? row.endDate,
    calorieTarget: Number(row.calorieTarget ?? 0),
    proteinTarget: Number(row.proteinTarget ?? 0),
    carbsTarget: Number(row.carbsTarget ?? 0),
    fatTarget: Number(row.fatTarget ?? 0),
    tdeeAtIssue: numberOrNull(row.tdeeAtIssue),
    tdeeVarianceAtIssue: numberOrNull(row.tdeeVarianceAtIssue),
    deltaFromPreviousCalories: numberOrNull(row.deltaFromPreviousCalories),
  };
}

export async function getActiveProgram(
  userId: string,
): Promise<MacrosProgram | null> {
  const row = await db.query.nutritionPrograms.findFirst({
    where: and(
      eq(nutritionPrograms.userId, userId),
      eq(nutritionPrograms.status, "active"),
    ),
  });
  return row ? mapProgram(row) : null;
}

export async function getTargetHistory(
  userId: string,
): Promise<MacrosTargetIssue[]> {
  const rows = await db.query.nutritionPlans.findMany({
    where: eq(nutritionPlans.userId, userId),
    orderBy: [
      desc(nutritionPlans.effectiveFrom),
      desc(nutritionPlans.createdAt),
    ],
  });
  return rows.map(mapIssue);
}

async function resolveEngineInputs(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  program: typeof nutritionPrograms.$inferSelect,
  effectiveFrom: string,
) {
  const [profile, expenditure, trend, linkedGoal, fallbackGoal, currentIssue] =
    await Promise.all([
      tx.query.userProfiles.findFirst({
        where: eq(userProfiles.userId, userId),
      }),
      tx.query.energyExpenditureEstimates.findFirst({
        where: and(
          eq(energyExpenditureEstimates.userId, userId),
          lte(energyExpenditureEstimates.logDate, effectiveFrom),
        ),
        orderBy: [desc(energyExpenditureEstimates.logDate)],
      }),
      tx.query.weightTrendPoints.findFirst({
        where: and(
          eq(weightTrendPoints.userId, userId),
          lte(weightTrendPoints.logDate, effectiveFrom),
        ),
        orderBy: [desc(weightTrendPoints.logDate)],
      }),
      program.activeWeightGoalId
        ? tx.query.weightGoals.findFirst({
            where: and(
              eq(weightGoals.userId, userId),
              eq(weightGoals.id, program.activeWeightGoalId),
            ),
          })
        : Promise.resolve(undefined),
      tx.query.weightGoals.findFirst({
        where: and(
          eq(weightGoals.userId, userId),
          eq(weightGoals.status, "active"),
        ),
      }),
      tx.query.nutritionPlans.findFirst({
        where: and(
          eq(nutritionPlans.userId, userId),
          eq(nutritionPlans.status, "active"),
        ),
        orderBy: [
          desc(nutritionPlans.effectiveFrom),
          desc(nutritionPlans.createdAt),
        ],
      }),
    ]);

  const goal = linkedGoal ?? fallbackGoal;
  const weightKg = Number(trend?.trendWeightKg ?? goal?.startWeightKg ?? 70);
  const ageYears = ageOnDate(profile?.birthDate ?? null, effectiveFrom);
  const prior = calculateExpenditurePrior({
    weightKg,
    heightCm: profile?.heightCm == null ? null : Number(profile.heightCm),
    ageYears,
    sex:
      profile?.sex === "female" ||
      profile?.sex === "male" ||
      profile?.sex === "other" ||
      profile?.sex === "prefer_not_to_say"
        ? profile.sex
        : null,
    activityLevel:
      profile?.activityLevel === "sedentary" ||
      profile?.activityLevel === "light" ||
      profile?.activityLevel === "moderate" ||
      profile?.activityLevel === "active" ||
      profile?.activityLevel === "very_active"
        ? profile.activityLevel
        : null,
  });
  const tdeeKcal = Number(expenditure?.estimatedTdee ?? prior.tdeeKcal);
  const tdeeVarianceKcal2 = Number(
    expenditure?.varianceKcal2 ?? prior.varianceKcal2,
  );
  const bmrKcal =
    prior.tdeeKcal / activityMultiplier(profile?.activityLevel ?? null);

  return {
    goal,
    currentIssue,
    target: calculateDynamicTargets({
      tdeeKcal,
      tdeeVarianceKcal2,
      bmrKcal,
      weightKg,
      goalType: program.goalType,
      goalRateKgPerWeek: Number(goal?.weeklyRateKg ?? 0),
      proteinGramsPerKg: Number(program.proteinGramsPerKg),
      fatGramsPerKg: numberOrNull(program.fatGramsPerKg),
      fatPercent: numberOrNull(program.fatPercent),
      previousCalories: numberOrNull(currentIssue?.calorieTarget ?? null),
      manualCalories: numberOrNull(program.manualCalorieTarget),
    }),
    tdeeKcal,
    tdeeVarianceKcal2,
  };
}

async function issueTargetsInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  program: typeof nutritionPrograms.$inferSelect,
  reason: MacrosPlanReason,
  effectiveFrom: string,
): Promise<MacrosTargetIssue> {
  const { currentIssue, target, tdeeKcal, tdeeVarianceKcal2 } =
    await resolveEngineInputs(tx, userId, program, effectiveFrom);

  if (
    reason === "check_in" &&
    program.mode !== "coached" &&
    (program.mode === "manual" ||
      Math.abs(target.calories - Number(currentIssue?.calorieTarget ?? 0)) <
        TARGET_CHANGE_THRESHOLD_KCAL)
  ) {
    if (!currentIssue)
      throw new Error("A manual program needs an initial issue");
    return mapIssue(currentIssue);
  }

  const status =
    program.mode === "collaborative" ? "pending_acceptance" : "active";
  if (status === "active" && currentIssue) {
    await tx
      .update(nutritionPlans)
      .set({
        status: "archived",
        effectiveTo: dateBefore(effectiveFrom),
        endDate: dateBefore(effectiveFrom),
        updatedAt: new Date(),
      })
      .where(eq(nutritionPlans.id, currentIssue.id));
  }

  if (status === "pending_acceptance") {
    await tx
      .update(nutritionPlans)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(nutritionPlans.userId, userId),
          eq(nutritionPlans.status, "pending_acceptance"),
        ),
      );
  }

  const [inserted] = await tx
    .insert(nutritionPlans)
    .values({
      userId,
      programId: program.id,
      name: `${program.mode === "manual" ? "Manual" : "Adaptive"} target`,
      status,
      goalType: program.goalType,
      startDate: effectiveFrom,
      effectiveFrom,
      reason,
      tdeeAtIssue: tdeeKcal.toFixed(2),
      tdeeVarianceAtIssue: tdeeVarianceKcal2.toFixed(2),
      deltaFromPreviousCalories:
        currentIssue?.calorieTarget == null
          ? null
          : (target.calories - Number(currentIssue.calorieTarget)).toFixed(2),
      calorieTarget: target.calories.toFixed(2),
      proteinTarget: target.proteinGrams.toFixed(2),
      carbsTarget: target.carbsGrams.toFixed(2),
      fatTarget: target.fatGrams.toFixed(2),
    })
    .returning();
  if (!inserted) throw new Error("Failed to issue nutrition targets");

  const cycling = macrosCalorieCyclingSchema.parse(program.calorieCycling);
  await tx.insert(nutritionPlanDays).values(
    buildCycledTargets(target, cycling).map((day) => ({
      planId: inserted.id,
      weekday: day.weekday,
      calorieTarget: day.calorieTarget.toFixed(2),
      proteinTarget: day.proteinTarget.toFixed(2),
      carbsTarget: day.carbsTarget.toFixed(2),
      fatTarget: day.fatTarget.toFixed(2),
    })),
  );
  return mapIssue(inserted);
}

export async function upsertProgram(
  userId: string,
  input: MacrosUpsertProgramBody,
): Promise<{ program: MacrosProgram; issue: MacrosTargetIssue }> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.nutritionPrograms.findFirst({
      where: and(
        eq(nutritionPrograms.userId, userId),
        eq(nutritionPrograms.status, "active"),
      ),
    });
    const values = {
      activeWeightGoalId: input.activeWeightGoalId ?? null,
      goalType: input.goalType,
      proteinGramsPerKg: input.proteinGramsPerKg.toFixed(2),
      fatGramsPerKg: input.fatGramsPerKg?.toFixed(2) ?? null,
      fatPercent: input.fatPercent?.toFixed(2) ?? null,
      distributionProfile: input.distributionProfile,
      calorieCycling: input.calorieCycling satisfies MacrosCalorieCycling,
      checkInWeekday: input.checkInWeekday,
      mode: input.mode,
      dietPhase: input.dietPhase,
      manualCalorieTarget: input.manualCalorieTarget?.toFixed(2) ?? null,
      updatedAt: new Date(),
    };
    const [program] = existing
      ? await tx
          .update(nutritionPrograms)
          .set(values)
          .where(eq(nutritionPrograms.id, existing.id))
          .returning()
      : await tx
          .insert(nutritionPrograms)
          .values({ userId, ...values })
          .returning();
    if (!program) throw new Error("Failed to save nutrition program");
    const profile = await tx.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
      columns: { timezone: true },
    });
    const today = toIsoDate(new Date(), profile?.timezone ?? "UTC");
    const issue = await issueTargetsInTransaction(
      tx,
      userId,
      program,
      existing ? "program_change" : "onboarding",
      today,
    );
    return { program: mapProgram(program), issue };
  });
}

export async function acceptPendingIssue(userId: string, issueId: string) {
  return db.transaction(async (tx) => {
    const pending = await tx.query.nutritionPlans.findFirst({
      where: and(
        eq(nutritionPlans.id, issueId),
        eq(nutritionPlans.userId, userId),
        eq(nutritionPlans.status, "pending_acceptance"),
      ),
    });
    if (!pending) return null;
    const effectiveFrom = pending.effectiveFrom ?? pending.startDate;
    await tx
      .update(nutritionPlans)
      .set({
        status: "archived",
        effectiveTo: dateBefore(effectiveFrom),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(nutritionPlans.userId, userId),
          eq(nutritionPlans.status, "active"),
          ne(nutritionPlans.id, issueId),
        ),
      );
    const [accepted] = await tx
      .update(nutritionPlans)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(nutritionPlans.id, issueId))
      .returning();
    return accepted ? mapIssue(accepted) : null;
  });
}

export async function issueTargetsForGoalChange(
  userId: string,
  goalId: string,
  goalType: "lose" | "maintain" | "gain",
) {
  return db.transaction(async (tx) => {
    const program = await tx.query.nutritionPrograms.findFirst({
      where: and(
        eq(nutritionPrograms.userId, userId),
        eq(nutritionPrograms.status, "active"),
      ),
    });
    if (!program) return null;
    const [updated] = await tx
      .update(nutritionPrograms)
      .set({ activeWeightGoalId: goalId, goalType, updatedAt: new Date() })
      .where(eq(nutritionPrograms.id, program.id))
      .returning();
    if (!updated) return null;
    const profile = await tx.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
      columns: { timezone: true },
    });
    return issueTargetsInTransaction(
      tx,
      userId,
      updated,
      "goal_change",
      toIsoDate(new Date(), profile?.timezone ?? "UTC"),
    );
  });
}

export async function runWeeklyProgramCheckIns() {
  const programs = await db.query.nutritionPrograms.findMany({
    where: eq(nutritionPrograms.status, "active"),
  });
  let issued = 0;
  let skipped = 0;
  for (const program of programs) {
    const profile = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, program.userId),
      columns: { timezone: true },
    });
    const today = toIsoDate(new Date(), profile?.timezone ?? "UTC");
    if (
      new Date(`${today}T00:00:00.000Z`).getUTCDay() !== program.checkInWeekday
    ) {
      skipped += 1;
      continue;
    }
    await db.transaction((tx) =>
      issueTargetsInTransaction(tx, program.userId, program, "check_in", today),
    );
    issued += 1;
  }
  return { programsProcessed: programs.length, issued, skipped };
}
