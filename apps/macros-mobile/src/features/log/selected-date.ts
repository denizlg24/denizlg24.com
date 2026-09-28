import { createStore, useStore } from "./store";

// `null` follows today, so a log left open overnight moves on with the clock
// instead of staying pinned to the day it was opened on.
const pinnedDate = createStore<string | null>(null);

export function useSelectedDate(today: string): string {
  const pinned = useStore(pinnedDate);
  return pinned !== null && pinned < today ? pinned : today;
}

export function selectDate(date: string, today: string) {
  pinnedDate.set(date >= today ? null : date);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 0);
  return (
    date.getFullYear() === year &&
    date.getMonth() === (month ?? 1) - 1 &&
    date.getDate() === day
  );
}
