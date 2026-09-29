import {
  type MacrosCalorieCycling,
  type MacrosCheckInBody,
  type MacrosCheckInResponse,
  type MacrosPlanReason,
  type MacrosProgram,
  type MacrosTargetIssue,
  type MacrosUpsertProgramBody,
  macrosCalorieCyclingSchema,
} from "@repo/schemas/macros";
import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/db/connection";
import {
  dailyNutritionSummaries,
  energyExpenditureEstimates,
  nutritionPlanDays,
  nutritionPlans,
  nutritionPrograms,
  userProfiles,
  weighIns,
  weightGoals,
  weightTrendPoints,
} from "@/db/schema";
import { updateActiveGoal } from "@/lib/goals/service";
import { shiftIso, toIsoDate } from "@/lib/weights/date-utils";
import { calculateExpenditurePrior } from "@/lib/weights/expenditure";
import { recomputeEnergyExpenditureInTransaction } from "@/lib/weights/expenditure-service";
import { recomputeWeightTrendInTransaction } from "@/lib/weights/trend-service";
import { caloriesFromMacros, checkInSchedule } from "./check-in";
import {
  buildCycledTargets,
  calculateDynamicTargets,
  type TargetEngineResult,
} from "./target-engine";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CustomTargets = NonNullable<MacrosCheckInBody["targets"]>;

export class NoProgramError extends Error {
  constructor() {
    super("Set up a program before checking in");
  }
}

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
  tx: Transaction,
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
  const previousCalories = numberOrNull(currentIssue?.calorieTarget ?? null);

  return {
    goal,
    currentIssue,
    expenditure,
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
      previousCalories,
      manualCalories: numberOrNull(program.manualCalorieTarget),
    }),
    engine: {
      tdeeKcal,
      tdeeVarianceKcal2,
      bmrKcal,
      weightKg,
      previousCalories,
    },
  };
}

function customTargetResult(
  targets: CustomTargets,
  engineResult: TargetEngineResult,
): TargetEngineResult {
  const calories = caloriesFromMacros(targets);
  return {
    ...engineResult,
    calories,
    proteinGrams: Math.round(targets.proteinGrams),
    carbsGrams: Math.round(targets.carbsGrams),
    fatGrams: Math.round(targets.fatGrams),
    unclampedCalories: calories,
    clamps: [],
  };
}

/**
 * Every issue is active the moment it is made: a check-in is the owner's
 * acceptance, so the old collaborative `pending_acceptance` step is gone.
 */
async function issueTargetsInTransaction(
  tx: Transaction,
  userId: string,
  program: typeof nutritionPrograms.$inferSelect,
  reason: MacrosPlanReason,
  effectiveFrom: string,
  custom?: CustomTargets | null,
): Promise<MacrosTargetIssue> {
  const resolved = await resolveEngineInputs(
    tx,
    userId,
    program,
    effectiveFrom,
  );
  const { currentIssue } = resolved;
  const { tdeeKcal, tdeeVarianceKcal2 } = resolved.engine;
  const target = custom
    ? customTargetResult(custom, resolved.target)
    : resolved.target;

  if (currentIssue) {
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

  // A proposal left waiting from before check-ins were manual is moot now.
  await tx
    .update(nutritionPlans)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(nutritionPlans.userId, userId),
        eq(nutritionPlans.status, "pending_acceptance"),
      ),
    );

  const [inserted] = await tx
    .insert(nutritionPlans)
    .values({
      userId,
      programId: program.id,
      name: custom
        ? "Custom target"
        : `${program.mode === "manual" ? "Manual" : "Adaptive"} target`,
      status: "active",
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

function programValues(input: MacrosUpsertProgramBody) {
  return {
    activeWeightGoalId: input.activeWeightGoalId ?? null,
    goalType: input.goalType,
    proteinGramsPerKg: input.proteinGramsPerKg.toFixed(2),
    fatGramsPerKg: input.fatGramsPerKg?.toFixed(2) ?? null,
    fatPercent: input.fatPercent?.toFixed(2) ?? null,
    distributionProfile: input.distributionProfile,
    calorieCycling: input.calorieCycling satisfies MacrosCalorieCycling,
    checkInWeekday: input.checkInWeekday,
    // Collaborative only differed by waiting for acceptance, which every check-in now is.
    mode: input.mode === "collaborative" ? "coached" : input.mode,
    dietPhase: input.dietPhase,
    manualCalorieTarget: input.manualCalorieTarget?.toFixed(2) ?? null,
    updatedAt: new Date(),
  } as const;
}

async function saveProgramRow(
  tx: Transaction,
  userId: string,
  existing: typeof nutritionPrograms.$inferSelect | undefined,
  input: MacrosUpsertProgramBody,
) {
  const values = programValues(input);
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
  return program;
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
    const program = await saveProgramRow(tx, userId, existing, input);
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

export async function acceptPendingIssue(
  userId: string,
  issueId: string,
): Promise<MacrosTargetIssue | null> {
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

async function lastCheckInOn(
  tx: Transaction,
  userId: string,
): Promise<string | null> {
  const row = await tx.query.nutritionPlans.findFirst({
    where: and(
      eq(nutritionPlans.userId, userId),
      inArray(nutritionPlans.reason, ["check_in", "onboarding"]),
      ne(nutritionPlans.status, "pending_acceptance"),
    ),
    orderBy: [desc(nutritionPlans.effectiveFrom)],
    columns: { effectiveFrom: true, startDate: true },
  });
  return row ? (row.effectiveFrom ?? row.startDate) : null;
}

/** The seven completed days before today: today's log is still being written. */
async function weekRecap(tx: Transaction, userId: string, today: string) {
  const from = shiftIso(today, -7);
  const to = shiftIso(today, -1);
  const [days, weighInRows, start, end] = await Promise.all([
    tx.query.dailyNutritionSummaries.findMany({
      where: and(
        eq(dailyNutritionSummaries.userId, userId),
        gte(dailyNutritionSummaries.logDate, from),
        lte(dailyNutritionSummaries.logDate, to),
      ),
      columns: { calories: true },
    }),
    tx.query.weighIns.findMany({
      where: and(
        eq(weighIns.userId, userId),
        gte(weighIns.logDate, from),
        lte(weighIns.logDate, to),
      ),
      columns: { id: true },
    }),
    tx.query.weightTrendPoints.findFirst({
      where: and(
        eq(weightTrendPoints.userId, userId),
        lte(weightTrendPoints.logDate, shiftIso(from, -1)),
      ),
      orderBy: [desc(weightTrendPoints.logDate)],
      columns: { trendWeightKg: true },
    }),
    tx.query.weightTrendPoints.findFirst({
      where: and(
        eq(weightTrendPoints.userId, userId),
        lte(weightTrendPoints.logDate, to),
      ),
      orderBy: [desc(weightTrendPoints.logDate)],
      columns: { trendWeightKg: true },
    }),
  ]);
  const logged = days
    .map((day) => Number(day.calories))
    .filter((calories) => calories > 0);
  return {
    from,
    to,
    loggedDays: logged.length,
    averageIntakeKcal:
      logged.length > 0
        ? Math.round(
            logged.reduce((sum, value) => sum + value, 0) / logged.length,
          )
        : null,
    weighIns: weighInRows.length,
    trendStartKg: start ? Number(start.trendWeightKg) : null,
    trendEndKg: end ? Number(end.trendWeightKg) : null,
  };
}

async function todayFor(tx: Transaction, userId: string) {
  const profile = await tx.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  });
  return toIsoDate(new Date(), profile?.timezone ?? "UTC");
}

/** Expenditure otherwise only moves on a weigh-in; a check-in reads it fresh. */
async function refreshEstimates(
  tx: Transaction,
  userId: string,
  today: string,
) {
  await recomputeWeightTrendInTransaction(tx, userId, today);
  await recomputeEnergyExpenditureInTransaction(tx, userId, today);
}

export async function getCheckIn(
  userId: string,
): Promise<MacrosCheckInResponse> {
  return db.transaction(async (tx) => {
    const program = await tx.query.nutritionPrograms.findFirst({
      where: and(
        eq(nutritionPrograms.userId, userId),
        eq(nutritionPrograms.status, "active"),
      ),
    });
    if (!program) throw new NoProgramError();
    const today = await todayFor(tx, userId);
    await refreshEstimates(tx, userId, today);
    const [resolved, last, week] = await Promise.all([
      resolveEngineInputs(tx, userId, program, today),
      lastCheckInOn(tx, userId),
      weekRecap(tx, userId, today),
    ]);
    const schedule = checkInSchedule({
      today,
      checkInWeekday: program.checkInWeekday,
      lastCheckInOn: last,
    });
    const { target } = resolved;
    return {
      scheduledOn: schedule.scheduledOn,
      nextOn: schedule.nextOn,
      lastCheckInOn: last,
      due: schedule.due,
      current: resolved.currentIssue ? mapIssue(resolved.currentIssue) : null,
      week,
      expenditure: {
        tdeeKcal: resolved.engine.tdeeKcal,
        varianceKcal2: resolved.engine.tdeeVarianceKcal2,
        previousTdeeKcal: numberOrNull(
          resolved.currentIssue?.tdeeAtIssue ?? null,
        ),
        method: resolved.expenditure?.method ?? null,
      },
      engine: resolved.engine,
      proposal: {
        calories: target.calories,
        proteinGrams: target.proteinGrams,
        carbsGrams: target.carbsGrams,
        fatGrams: target.fatGrams,
        clamps: target.clamps,
      },
    };
  });
}

/**
 * The goal is applied first and outside the transaction: `updateActiveGoal`
 * owns its own writes, and going through the goal route instead would issue a
 * `goal_change` target whose weekly clamp this check-in would then stack on.
 */
export async function checkIn(
  userId: string,
  body: MacrosCheckInBody,
): Promise<{ program: MacrosProgram; issue: MacrosTargetIssue }> {
  const existing = await getActiveProgram(userId);
  if (!existing) throw new NoProgramError();
  const goal = body.goal ? await updateActiveGoal(userId, body.goal) : null;
  return db.transaction(async (tx) => {
    const row = await tx.query.nutritionPrograms.findFirst({
      where: eq(nutritionPrograms.id, existing.id),
    });
    const program = await saveProgramRow(tx, userId, row, {
      ...body.program,
      activeWeightGoalId:
        goal?.id ??
        body.program.activeWeightGoalId ??
        existing.activeWeightGoalId,
      goalType: goal?.goalType ?? body.program.goalType,
    });
    const today = await todayFor(tx, userId);
    await refreshEstimates(tx, userId, today);
    const issue = await issueTargetsInTransaction(
      tx,
      userId,
      program,
      "check_in",
      today,
      body.targets,
    );
    return { program: mapProgram(program), issue };
  });
}
