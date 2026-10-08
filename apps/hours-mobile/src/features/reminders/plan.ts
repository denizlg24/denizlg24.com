import type { WorkHoursOverview } from "@repo/schemas";
import { formatMinutes, formatMoney, shiftActivityState } from "@repo/utils";

export interface ReminderSettings {
  /** Hours on the clock before "still checked in"; 0 turns it off. */
  longShiftHours: number;
  /** Worked hours without any break before "break"; 0 turns it off. */
  breakAfterHours: number;
  /** Minutes into a break before "resume"; 0 turns it off. */
  breakLengthMinutes: number;
  weeklyTarget: boolean;
  payday: boolean;
}

export const DEFAULT_SETTINGS: ReminderSettings = {
  longShiftHours: 10,
  breakAfterHours: 5.5,
  breakLengthMinutes: 30,
  weeklyTarget: true,
  payday: true,
};

export type ReminderCategory = "shift" | "break";

export interface PlannedReminder {
  id: string;
  at: Date;
  title: string;
  body: string;
  /** Breaks through Focus: the moments a shift goes wrong. */
  timeSensitive: boolean;
  category?: ReminderCategory;
}

const HOUR = 60 * 60 * 1000;

function time(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Every reminder the current state implies, as dated one-offs. Re-planned on
 * each change of the overview — a repeating trigger could not tell that the
 * shift it was about already ended.
 */
export function planReminders(
  overview: WorkHoursOverview,
  settings: ReminderSettings,
  now: Date = new Date(),
): PlannedReminder[] {
  const reminders: PlannedReminder[] = [];
  const active = overview.active;
  const job = active
    ? overview.jobs.find((row) => row.id === active.jobId)
    : undefined;
  const state = active
    ? shiftActivityState(active, job?.breaksPaid ?? false, now)
    : null;

  if (active && state?.status === "working") {
    const start = new Date(active.start);
    if (settings.longShiftHours > 0) {
      reminders.push({
        id: "long-shift",
        at: new Date(start.getTime() + settings.longShiftHours * HOUR),
        title: "Still checked in",
        body: `${job?.name ?? "Shift"} since ${time(start)}`,
        timeSensitive: true,
        category: "shift",
      });
    }
    if (settings.breakAfterHours > 0 && active.breaks.length === 0) {
      reminders.push({
        id: "break-due",
        at: new Date(state.workedFrom * 1000 + settings.breakAfterHours * HOUR),
        title: "Break",
        body: `${formatMinutes(settings.breakAfterHours * 60)} worked without one`,
        timeSensitive: true,
        category: "shift",
      });
    }
    const target = overview.jobs
      .filter((row) => row.status === "active")
      .reduce((sum, row) => sum + (row.expectedWeeklyHours ?? 0), 0);
    if (settings.weeklyTarget && target > 0) {
      // The overview's week counts the open shift up to the server's now.
      const weekNow =
        overview.week.workedMinutes -
        active.workedMinutes +
        Math.floor(state.workedSeconds / 60);
      const remaining = target * 60 - weekNow;
      if (remaining > 0) {
        reminders.push({
          id: "week-target",
          at: new Date(now.getTime() + remaining * 60_000),
          title: "Week done",
          body: `${formatMinutes(target * 60)} this week`,
          timeSensitive: false,
        });
      }
    }
  }

  if (state?.status === "break" && state.breakFrom !== null) {
    if (settings.breakLengthMinutes > 0) {
      reminders.push({
        id: "break-over",
        at: new Date(
          state.breakFrom * 1000 + settings.breakLengthMinutes * 60_000,
        ),
        title: "Break over",
        body: `${settings.breakLengthMinutes} min since ${time(new Date(state.breakFrom * 1000))}`,
        timeSensitive: true,
        category: "break",
      });
    }
  }

  if (settings.payday) {
    for (const period of overview.payPeriods) {
      const [year, month, day] = period.payoutDate.split("-").map(Number);
      const at = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 9, 0);
      reminders.push({
        id: `payday-${period.ruleId}-${period.payoutDate}`,
        at,
        title: "Payday",
        body: `${period.ruleName} · ${formatMoney(period.netMinor, period.currency)}`,
        timeSensitive: false,
      });
    }
  }

  return reminders.filter((reminder) => reminder.at > now);
}
