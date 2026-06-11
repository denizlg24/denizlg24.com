"use client";

import { endOfMonth, isSameDay, startOfMonth } from "date-fns";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ILeanCalendarEvent } from "@/models/CalendarEvent";

interface CalendarContextType {
  events: ILeanCalendarEvent[];
  loading: boolean;
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  refreshEvents: () => Promise<void>;
  getEventsForDay: (date: Date) => ILeanCalendarEvent[];
  getTodaysEvents: () => ILeanCalendarEvent[];
  updateEventStatus: (
    eventId: string,
    status: "scheduled" | "completed" | "canceled",
  ) => void;
}

const CalendarContext = createContext<CalendarContextType | null>(null);

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<ILeanCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const fetchMonthEvents = useCallback(async (month: Date) => {
    setLoading(true);
    try {
      const start = startOfMonth(month);
      const end = endOfMonth(month);

      const response = await fetch(
        `/api/admin/calendar?start=${start.toISOString()}&end=${end.toISOString()}`,
      );

      if (response.ok) {
        const data = await response.json();
        setEvents(data.events || []);
      }
    } catch (error) {
      console.error("Failed to fetch month events:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonthEvents(currentMonth);
  }, [currentMonth, fetchMonthEvents]);

  const refreshEvents = useCallback(async () => {
    await fetchMonthEvents(currentMonth);
  }, [currentMonth, fetchMonthEvents]);

  const getEventsForDay = useCallback(
    (date: Date) => {
      return events.filter((event) => isSameDay(new Date(event.date), date));
    },
    [events],
  );

  const getTodaysEvents = useCallback(() => {
    const today = new Date();
    return events.filter((event) => isSameDay(new Date(event.date), today));
  }, [events]);

  const updateEventStatus = useCallback(
    (eventId: string, status: "scheduled" | "completed" | "canceled") => {
      setEvents((prev) =>
        prev.map((event) =>
          event._id === eventId ? { ...event, status } : event,
        ),
      );
    },
    [],
  );

  return (
    <CalendarContext.Provider
      value={{
        events,
        loading,
        currentMonth,
        setCurrentMonth,
        refreshEvents,
        getEventsForDay,
        getTodaysEvents,
        updateEventStatus,
      }}
    >
      {children}
    </CalendarContext.Provider>
  );
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error("useCalendar must be used within a CalendarProvider");
  }
  return context;
}
