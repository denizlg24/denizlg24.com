import type {
  MacrosNotificationPreferences,
  MacrosRegisterPushDeviceBody,
  MacrosUpdateNotificationPreferencesBody,
} from "@repo/schemas/macros";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/connection";
import { notificationPreferences, pushDevices } from "@/db/schema";

/**
 * A token names an app install, not a person: when someone else signs in on
 * the same phone the row moves to them, so the previous account stops
 * receiving pushes on a device it no longer uses.
 */
export async function registerPushDevice(
  userId: string,
  input: MacrosRegisterPushDeviceBody,
) {
  const now = new Date();
  const [device] = await db
    .insert(pushDevices)
    .values({
      userId,
      token: input.token,
      environment: input.environment,
      bundleId: input.bundleId,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: pushDevices.token,
      set: {
        userId,
        environment: input.environment,
        bundleId: input.bundleId,
        lastSeenAt: now,
        disabledAt: null,
        updatedAt: now,
      },
    })
    .returning({
      id: pushDevices.id,
      environment: pushDevices.environment,
      lastSeenAt: pushDevices.lastSeenAt,
    });

  if (!device) throw new Error("Push device upsert returned no row");
  return { ...device, lastSeenAt: device.lastSeenAt.toISOString() };
}

/** Only the caller's own row: a token is not proof of owning a device. */
export async function unregisterPushDevice(userId: string, token: string) {
  const removed = await db
    .delete(pushDevices)
    .where(and(eq(pushDevices.token, token), eq(pushDevices.userId, userId)))
    .returning({ id: pushDevices.id });
  return removed.length > 0;
}

const DEFAULT_PREFERENCES: MacrosNotificationPreferences = {
  weeklySummary: true,
  streakNudge: true,
  streakNudgeHour: 20,
};

export async function getNotificationPreferences(
  userId: string,
): Promise<MacrosNotificationPreferences> {
  const row = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.userId, userId),
    columns: { weeklySummary: true, streakNudge: true, streakNudgeHour: true },
  });
  return row ?? DEFAULT_PREFERENCES;
}

export async function updateNotificationPreferences(
  userId: string,
  input: MacrosUpdateNotificationPreferencesBody,
): Promise<MacrosNotificationPreferences> {
  const now = new Date();
  const [row] = await db
    .insert(notificationPreferences)
    .values({ userId, ...DEFAULT_PREFERENCES, ...input })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { ...input, updatedAt: now },
    })
    .returning({
      weeklySummary: notificationPreferences.weeklySummary,
      streakNudge: notificationPreferences.streakNudge,
      streakNudgeHour: notificationPreferences.streakNudgeHour,
    });

  if (!row) throw new Error("Notification preferences upsert returned no row");
  return row;
}
