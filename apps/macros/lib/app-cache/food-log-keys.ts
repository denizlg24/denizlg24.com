export const foodLogQueryKeys = {
  day: (date: string) => ["food-log", "day", date] as const,
  overview: (range: string, date?: string) =>
    ["food-log", "overview", range, date ?? null] as const,
  weekTotals: (start: string, end: string) =>
    ["food-log", "week-totals", start, end] as const,
  calendarTotals: (start: string, end: string) =>
    ["food-log", "calendar-totals", start, end] as const,
  activity: ["food-log", "activity", "v1"] as const,
}
