import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/connection";
import { foodLogEntries } from "@/db/schema";
import { shiftIso } from "@/lib/weights/date-utils";
import { createPushSender } from "./apns";
import { streakNudgeMessage } from "./messages";
import {
  addCounts,
  claimSend,
  emptyRunResult,
  loadPushRecipients,
  type PushRunResult,
} from "./recipients";
import { isStreakNudgeDue, localClock } from "./windows";

async function loggedYesterdayOnly(userId: string, today: string) {
  const yesterday = shiftIso(today, -1);
  const rows = await db
    .selectDistinct({ logDate: foodLogEntries.logDate })
    .from(foodLogEntries)
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        inArray(foodLogEntries.logDate, [yesterday, today]),
      ),
    );
  const dates = new Set(rows.map((row) => row.logDate));
  return dates.has(yesterday) && !dates.has(today);
}

/** At the user's chosen hour, when yesterday has food and today has none. */
export async function sendStreakNudges(
  now = new Date(),
): Promise<PushRunResult> {
  const sender = createPushSender();
  if (!sender.configured) return emptyRunResult(false);

  const result = emptyRunResult(true);
  const message = streakNudgeMessage();
  try {
    const recipients = await loadPushRecipients();
    result.recipients = recipients.length;
    for (const recipient of recipients) {
      if (!recipient.streakNudge) continue;
      const clock = localClock(now, recipient.timezone);
      if (
        !clock ||
        !isStreakNudgeDue(
          clock,
          recipient.streakNudgeHour,
          recipient.lastStreakNudgeOn,
        )
      ) {
        continue;
      }
      try {
        if (!(await loggedYesterdayOnly(recipient.userId, clock.date))) {
          continue;
        }
        result.due += 1;
        if (
          !(await claimSend(recipient.userId, "lastStreakNudgeOn", clock.date))
        ) {
          continue;
        }
        addCounts(result, await sender.send(recipient.devices, message));
        result.notified += 1;
      } catch (error) {
        console.error(
          `[push] streak nudge for ${recipient.userId} failed`,
          error,
        );
      }
    }
  } finally {
    sender.close();
  }
  return result;
}
