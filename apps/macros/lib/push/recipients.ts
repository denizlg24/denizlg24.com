import { eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/connection";
import {
  notificationPreferences,
  pushDevices,
  userProfiles,
} from "@/db/schema";
import type { PushDevice, PushSendCounts } from "./apns";

export type PushRecipient = {
  userId: string;
  timezone: string;
  weightUnit: string;
  energyUnit: string;
  weeklySummary: boolean;
  streakNudge: boolean;
  streakNudgeHour: number;
  lastWeeklySummaryOn: string | null;
  lastStreakNudgeOn: string | null;
  devices: PushDevice[];
};

/** Everyone with at least one live device, with preferences defaulted. */
export async function loadPushRecipients(): Promise<PushRecipient[]> {
  const rows = await db
    .select({
      userId: pushDevices.userId,
      deviceId: pushDevices.id,
      token: pushDevices.token,
      environment: pushDevices.environment,
      bundleId: pushDevices.bundleId,
      timezone: userProfiles.timezone,
      weightUnit: userProfiles.weightUnit,
      energyUnit: userProfiles.energyUnit,
      weeklySummary: notificationPreferences.weeklySummary,
      streakNudge: notificationPreferences.streakNudge,
      streakNudgeHour: notificationPreferences.streakNudgeHour,
      lastWeeklySummaryOn: notificationPreferences.lastWeeklySummaryOn,
      lastStreakNudgeOn: notificationPreferences.lastStreakNudgeOn,
    })
    .from(pushDevices)
    .innerJoin(userProfiles, eq(userProfiles.userId, pushDevices.userId))
    .leftJoin(
      notificationPreferences,
      eq(notificationPreferences.userId, pushDevices.userId),
    )
    .where(isNull(pushDevices.disabledAt));

  const byUser = new Map<string, PushRecipient>();
  for (const row of rows) {
    const device: PushDevice = {
      id: row.deviceId,
      token: row.token,
      environment: row.environment,
      bundleId: row.bundleId,
    };
    const existing = byUser.get(row.userId);
    if (existing) {
      existing.devices.push(device);
      continue;
    }
    byUser.set(row.userId, {
      userId: row.userId,
      timezone: row.timezone,
      weightUnit: row.weightUnit,
      energyUnit: row.energyUnit,
      weeklySummary: row.weeklySummary ?? true,
      streakNudge: row.streakNudge ?? true,
      streakNudgeHour: row.streakNudgeHour ?? 20,
      lastWeeklySummaryOn: row.lastWeeklySummaryOn,
      lastStreakNudgeOn: row.lastStreakNudgeOn,
      devices: [device],
    });
  }
  return [...byUser.values()];
}

/**
 * Stamps the send date unless it already holds it, and reports whether this
 * call made the change. Two overlapping cron runs both see the user as due;
 * only the one whose stamp lands sends.
 */
export async function claimSend(
  userId: string,
  column: "lastWeeklySummaryOn" | "lastStreakNudgeOn",
  date: string,
): Promise<boolean> {
  const target = notificationPreferences[column];
  const stamp =
    column === "lastWeeklySummaryOn"
      ? { lastWeeklySummaryOn: date }
      : { lastStreakNudgeOn: date };
  const claimed = await db
    .insert(notificationPreferences)
    .values({ userId, ...stamp })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { ...stamp, updatedAt: new Date() },
      setWhere: sql`${target} is distinct from ${date}`,
    })
    .returning({ userId: notificationPreferences.userId });
  return claimed.length > 0;
}

export type PushRunResult = {
  configured: boolean;
  recipients: number;
  due: number;
  notified: number;
} & PushSendCounts;

export function emptyRunResult(configured: boolean): PushRunResult {
  return {
    configured,
    recipients: 0,
    due: 0,
    notified: 0,
    sent: 0,
    failed: 0,
    disabled: 0,
    skipped: 0,
  };
}

export function addCounts(result: PushRunResult, counts: PushSendCounts) {
  result.sent += counts.sent;
  result.failed += counts.failed;
  result.disabled += counts.disabled;
  result.skipped += counts.skipped;
}
