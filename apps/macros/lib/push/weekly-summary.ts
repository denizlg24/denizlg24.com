import { and, asc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/db/connection";
import { weightTrendPoints } from "@/db/schema";
import { getFoodLogWeekTotals } from "@/lib/queries/food-log-week-totals";
import { shiftIso } from "@/lib/weights/date-utils";
import { createPushSender } from "./apns";
import { weeklySummaryMessage } from "./messages";
import {
  addCounts,
  claimSend,
  emptyRunResult,
  loadPushRecipients,
  type PushRecipient,
  type PushRunResult,
} from "./recipients";
import {
  isWeeklySummaryDue,
  localClock,
  previousWeek,
  weeklyTrendChangeKg,
} from "./windows";

async function summaryFor(recipient: PushRecipient, today: string) {
  const week = previousWeek(today);
  const [totals, trend] = await Promise.all([
    getFoodLogWeekTotals(recipient.userId, week.start, week.end),
    db
      .select({
        date: weightTrendPoints.logDate,
        trendWeightKg: weightTrendPoints.trendWeightKg,
        hasObservation: weightTrendPoints.hasObservation,
      })
      .from(weightTrendPoints)
      .where(
        and(
          eq(weightTrendPoints.userId, recipient.userId),
          gte(weightTrendPoints.logDate, shiftIso(week.start, -7)),
          lte(weightTrendPoints.logDate, week.end),
        ),
      )
      .orderBy(asc(weightTrendPoints.logDate)),
  ]);

  const logged = totals.days.filter((day) => day.calories > 0);
  return weeklySummaryMessage({
    daysLogged: logged.length,
    averageCalories:
      logged.length > 0
        ? logged.reduce((sum, day) => sum + day.calories, 0) / logged.length
        : null,
    calorieTarget: totals.calorieTarget,
    trendChangeKg: weeklyTrendChangeKg(
      trend.map((point) => ({
        date: point.date,
        trendWeightKg: Number(point.trendWeightKg),
        hasObservation: point.hasObservation,
      })),
      week,
    ),
    energyUnit: recipient.energyUnit,
    weightUnit: recipient.weightUnit,
  });
}

/**
 * Monday 09:00 local: last week's logging, average intake against target and
 * the trend's move. Reads the finalized daily summaries, so it relies on the
 * reset-days cron having closed Sunday by then.
 */
export async function sendWeeklySummaries(
  now = new Date(),
): Promise<PushRunResult> {
  const sender = createPushSender();
  if (!sender.configured) return emptyRunResult(false);

  const result = emptyRunResult(true);
  try {
    const recipients = await loadPushRecipients();
    result.recipients = recipients.length;
    for (const recipient of recipients) {
      if (!recipient.weeklySummary) continue;
      const clock = localClock(now, recipient.timezone);
      if (!clock || !isWeeklySummaryDue(clock, recipient.lastWeeklySummaryOn)) {
        continue;
      }
      result.due += 1;
      try {
        const message = await summaryFor(recipient, clock.date);
        if (
          !(await claimSend(
            recipient.userId,
            "lastWeeklySummaryOn",
            clock.date,
          ))
        ) {
          continue;
        }
        addCounts(result, await sender.send(recipient.devices, message));
        result.notified += 1;
      } catch (error) {
        console.error(
          `[push] weekly summary for ${recipient.userId} failed`,
          error,
        );
      }
    }
  } finally {
    sender.close();
  }
  return result;
}
