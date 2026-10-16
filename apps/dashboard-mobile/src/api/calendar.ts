import type {
  CalendarEventResponse,
  CalendarEventsResponse,
  CalendarEventWrite,
  CourseDetailResponse,
  SemesterOverviewResponse,
  TimetableResponse,
} from "@repo/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { todayKey } from "./today";

export const AGENDA_DAYS = 14;

export function agendaRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + AGENDA_DAYS);
  return { start, end };
}

export function useCalendarEvents() {
  const { start, end } = agendaRange();
  return useQuery({
    queryKey: ["calendar", start.toISOString()],
    queryFn: async () =>
      (
        await api.request<CalendarEventsResponse>("calendar", {
          query: { start: start.toISOString(), end: end.toISOString() },
        })
      ).events,
  });
}

export function useTimetable() {
  return useQuery({
    queryKey: ["timetable"],
    queryFn: async () =>
      (await api.request<TimetableResponse>("timetable")).entries,
    staleTime: 60 * 60_000,
  });
}

export function useSemesterOverview() {
  return useQuery({
    queryKey: ["courses", "overview"],
    queryFn: async () =>
      (await api.request<SemesterOverviewResponse>("courses/overview"))
        .overview,
  });
}

export function useCourse(id: string) {
  return useQuery({
    queryKey: ["courses", id],
    queryFn: async () =>
      (await api.request<CourseDetailResponse>(`courses/${id}`)).detail,
  });
}

function useRefreshCalendar() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["calendar"] });
    void client.invalidateQueries({ queryKey: todayKey });
  };
}

export function useSaveEvent() {
  const refresh = useRefreshCalendar();
  return useMutation({
    mutationFn: ({ id, event }: { id?: string; event: CalendarEventWrite }) =>
      api.request<CalendarEventResponse>(id ? `calendar/${id}` : "calendar", {
        method: id ? "PATCH" : "POST",
        body: event,
      }),
    onSettled: refresh,
  });
}

export function useDeleteEvent() {
  const refresh = useRefreshCalendar();
  return useMutation({
    mutationFn: (id: string) =>
      api.request(`calendar/${id}`, { method: "DELETE" }),
    onSettled: refresh,
  });
}
