export const queryKeys = {
  dashboard: ["app", "dashboard", "v3"] as const,
  calorieSummary: ["app", "calorie-summary"] as const,
  weightOverview: ["weight", "overview"] as const,
  foodHistory: (limit: number) => ["foods", "history", { limit }] as const,
}
