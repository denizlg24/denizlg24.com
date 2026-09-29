import { isoToUtcDate, shiftIso } from "../weights/date-utils";

export type CheckInSchedule = {
  scheduledOn: string;
  nextOn: string;
  due: boolean;
};

/**
 * `checkInWeekday` keeps Sunday as 0. A check-in stays due from its weekday
 * until one is made, so a missed Monday is still waiting on Thursday.
 */
export function checkInSchedule(input: {
  today: string;
  checkInWeekday: number;
  lastCheckInOn: string | null;
}): CheckInSchedule {
  const weekday = isoToUtcDate(input.today).getUTCDay();
  const back = (weekday - input.checkInWeekday + 7) % 7;
  const scheduledOn = shiftIso(input.today, -back);
  const due = input.lastCheckInOn == null || input.lastCheckInOn < scheduledOn;
  return {
    scheduledOn,
    nextOn: due ? scheduledOn : shiftIso(scheduledOn, 7),
    due,
  };
}

/** Calories implied by grams, the way every target in the app adds up. */
export function caloriesFromMacros(macros: {
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
}): number {
  return Math.round(
    macros.proteinGrams * 4 + macros.carbsGrams * 4 + macros.fatGrams * 9,
  );
}
