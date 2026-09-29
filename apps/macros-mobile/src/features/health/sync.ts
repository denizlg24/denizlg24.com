import { MacrosHealth } from "@modules/macros-health";
import type { QueryClient } from "@tanstack/react-query";
import { fetchFoodLogDay } from "@/api/food-log";
import { postHealthSync } from "@/api/health-sync";
import { invalidateAfterWeighIn } from "@/api/keys";
import { errorMessage } from "@/lib/api";
import { capabilities } from "@/lib/config";
import { isoToday, shiftIsoDate } from "@/lib/day";
import { getHealthState, updateHealthState } from "./health-state";
import { buildImportBody, importWindow } from "./import-body";

/** Days written back after a first sync, so Health is not blank before today. */
const NUTRITION_BACKFILL_DAYS = 7;

export function healthAvailable() {
  return capabilities.healthKit && MacrosHealth?.isAvailable() === true;
}

// One sync at a time: a foreground and a log change landing together would
// otherwise post the same window twice and race on `importedThrough`.
let queue: Promise<void> = Promise.resolve();

function serialize(task: () => Promise<void>) {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

async function importFromHealth(queryClient: QueryClient, timeZone: string) {
  if (!MacrosHealth) return;
  const today = isoToday(timeZone);
  const { start, end } = importWindow(today, getHealthState().importedThrough);
  const [body, activity] = await Promise.all([
    MacrosHealth.readBodySamples(start, end, timeZone),
    MacrosHealth.readDailyActivity(start, end, timeZone),
  ]);
  const result = await postHealthSync(buildImportBody(body, activity));
  updateHealthState({ importedThrough: end });
  if (result.weighInsCreated > 0) await invalidateAfterWeighIn(queryClient);
  else if (result.activitiesUpserted > 0) {
    await Promise.all(
      [["body"], ["statistics"], ["strategy"]].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  }
}

async function writeNutrition(dates: string[], timeZone: string) {
  if (!MacrosHealth) return;
  const days = await Promise.all(dates.map((date) => fetchFoodLogDay(date)));
  await MacrosHealth.writeDailyNutrition(
    days.map((day) => ({
      date: day.date,
      calories: day.totals.calories,
      protein: day.totals.protein,
      carbs: day.totals.carbs,
      fat: day.totals.fat,
    })),
    timeZone,
  );
}

function recentDates(timeZone: string, count: number) {
  const today = isoToday(timeZone);
  return Array.from({ length: count }, (_, index) =>
    shiftIsoDate(today, -index),
  );
}

function record(task: Promise<void>) {
  return task.then(
    () => updateHealthState({ lastSyncedAt: Date.now(), lastError: null }),
    (error: unknown) => {
      updateHealthState({ lastError: errorMessage(error) });
    },
  );
}

/** Pull weight and activity in, push today's and yesterday's eating out. */
export function syncHealth(
  queryClient: QueryClient,
  timeZone: string,
  { backfill = false }: { backfill?: boolean } = {},
) {
  return serialize(() =>
    record(
      Promise.all([
        importFromHealth(queryClient, timeZone),
        writeNutrition(
          recentDates(timeZone, backfill ? NUTRITION_BACKFILL_DAYS : 2),
          timeZone,
        ),
      ]).then(() => undefined),
    ),
  );
}

/** After a log change only the eating side can have moved. */
export function syncNutrition(timeZone: string) {
  return serialize(() =>
    record(writeNutrition(recentDates(timeZone, 2), timeZone)),
  );
}

export async function enableHealth(queryClient: QueryClient, timeZone: string) {
  if (!MacrosHealth) return;
  await MacrosHealth.requestAuthorization();
  updateHealthState({ enabled: true, importedThrough: null, lastError: null });
  await syncHealth(queryClient, timeZone, { backfill: true });
}

export function disableHealth() {
  updateHealthState({ enabled: false });
}
