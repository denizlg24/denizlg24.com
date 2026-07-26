import type { SafeNotificationEvent } from "@repo/schemas/cloud";
import { desc, lte } from "drizzle-orm";

import type { Database } from "../db";
import { notificationEvents } from "../db/schema";

function serialize(
  row: typeof notificationEvents.$inferSelect,
): SafeNotificationEvent {
  return {
    id: row.id,
    eventKey: row.eventKey,
    type: row.type,
    severity: row.severity,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastSentAt: row.lastSentAt?.toISOString() ?? null,
    sendCount: row.sendCount,
    suppressedCount: row.suppressedCount,
    lastPayload: row.lastPayload,
  };
}

export async function listNotificationEvents(
  db: Database,
  options: { limit?: number } = {},
): Promise<SafeNotificationEvent[]> {
  const rows = await db
    .select()
    .from(notificationEvents)
    .orderBy(desc(notificationEvents.lastSeenAt))
    .limit(options.limit ?? 50);
  return rows.map(serialize);
}

export async function pruneNotificationEvents(
  db: Database,
  options: { retentionDays: number; now?: Date },
): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - options.retentionDays * 24 * 60 * 60 * 1_000,
  );
  const deleted = await db
    .delete(notificationEvents)
    .where(lte(notificationEvents.lastSeenAt, cutoff))
    .returning({ id: notificationEvents.id });
  return deleted.length;
}
