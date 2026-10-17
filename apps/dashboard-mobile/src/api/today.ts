import { DashboardNative } from "@modules/dashboard-native";
import type { DashboardToday, UpcomingKanbanResult } from "@repo/schemas";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const todayKey = ["today"] as const;
export const upcomingTasksKey = ["kanban", "upcoming"] as const;

export function useToday() {
  return useQuery({
    queryKey: todayKey,
    queryFn: async () => {
      const today = await api.request<DashboardToday>("dashboard/today");
      DashboardNative?.setToday(JSON.stringify(today));
      return today;
    },
    staleTime: 30_000,
  });
}

/** Kanban cards due in the next week, the desktop's Tasks pane. */
export function useUpcomingTasks() {
  return useQuery({
    queryKey: upcomingTasksKey,
    queryFn: () => api.request<UpcomingKanbanResult>("kanban/upcoming?days=7"),
    staleTime: 60_000,
  });
}
