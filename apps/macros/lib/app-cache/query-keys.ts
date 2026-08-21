export const queryKeys = {
  dashboard: ["app", "dashboard", "v3"] as const,
  dashboardForDay: (day: string) => ["app", "dashboard", "v3", day] as const,
  calorieSummary: ["app", "calorie-summary"] as const,
  calorieSummaryForDay: (day: string) =>
    ["app", "calorie-summary", day] as const,
  weightOverview: ["weight", "overview"] as const,
  foodHistory: (limit: number) => ["foods", "history", { limit }] as const,
};
