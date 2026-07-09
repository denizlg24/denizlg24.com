"use client";

import type {
  ICalendarEvent,
  ICalendarGoogleIntegrationStatus,
} from "@repo/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Calendar } from "@repo/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@repo/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { PageHeader } from "@repo/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Separator } from "@repo/ui/separator";
import { Switch } from "@repo/ui/switch";
import { format, formatDuration } from "date-fns";
import {
  Bell,
  BellOff,
  CalendarDays,
  CalendarIcon,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  MapPin,
  Pencil,
  Plane,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import {
  deleteCachedCalendarEvents,
  fetchCalendarEvents,
  fetchGoogleCalendarStatus,
  getCachedCalendarEvents,
  getCachedGoogleCalendarStatus,
  getCalendarMonthRange,
  removeCachedCalendarEvent,
  replaceCachedCalendarEvent,
  setCachedGoogleCalendarStatus,
} from "./calendar-data";
import { CalendarGrid } from "./calendar-grid";

function getFaviconUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
  } catch {
    return null;
  }
}

interface EventLink {
  label: string;
  url: string;
  icon?: string;
}

type CalendarGoogleStatusPatchResult = Omit<
  ICalendarGoogleIntegrationStatus,
  "pendingSyncCount" | "failedSyncCount"
> &
  Partial<
    Pick<
      ICalendarGoogleIntegrationStatus,
      "pendingSyncCount" | "failedSyncCount"
    >
  >;

const USER_EVENT_KIND_OPTIONS = [
  { value: "manual", label: "Event", icon: CalendarIcon },
  { value: "meeting", label: "Meeting", icon: Users },
  { value: "flight", label: "Flight", icon: Plane },
  { value: "birthday", label: "Birthday", icon: CalendarDays },
] as const;

function getEventKindLabel(kind: ICalendarEvent["kind"]) {
  if (kind === "meeting") return "Meeting";
  if (kind === "flight") return "Flight";
  if (kind === "birthday") return "Birthday";
  if (kind === "holiday") return "Holiday";
  return "Event";
}

function getSmartNotificationOptions(dateStr: string) {
  const date = new Date(dateStr);
  const hours = date.getHours();
  const eventMinutes = hours * 60 + date.getMinutes();

  const options: { value: string; label: string }[] = [];
  const added = new Set<string>();

  const add = (value: string, label: string) => {
    if (!added.has(value)) {
      options.push({ value, label });
      added.add(value);
    }
  };

  add("0", "At time of event");

  if (hours < 12) {
    add("5", "5 minutes before");
    add("15", "15 minutes before");
    add("30", "30 minutes before");
    add("60", "1 hour before");
    if (hours >= 9) {
      const toDayBefore9AM = eventMinutes + (24 * 60 - 9 * 60);
      add(toDayBefore9AM.toString(), "Day before at 9 AM");
    }
  } else if (hours < 18) {
    add("15", "15 minutes before");
    add("30", "30 minutes before");
    add("60", "1 hour before");
    add("120", "2 hours before");
    const toSameDay9AM = eventMinutes - 9 * 60;
    if (toSameDay9AM > 0) {
      add(toSameDay9AM.toString(), "Same day at 9 AM");
    }
  } else {
    add("30", "30 minutes before");
    add("60", "1 hour before");
    add("120", "2 hours before");
    const toSameDay9AM = eventMinutes - 9 * 60;
    add(toSameDay9AM.toString(), "Same day at 9 AM");
    const toSameDay5PM = eventMinutes - 17 * 60;
    if (toSameDay5PM > 0) {
      add(toSameDay5PM.toString(), "Same day at 5 PM");
    }
  }

  add("1440", "1 day before");
  add("2880", "2 days before");
  add("10080", "1 week before");

  return options;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function isAbortError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return true;

  const message = getErrorMessage(error).toLowerCase();
  return message === "request cancelled" || message === "request canceled";
}

export function CalendarPage() {
  const { client, slots } = useAdmin();
  const initialRange = useMemo(() => getCalendarMonthRange(), []);
  const initialCachedEvents = useMemo(
    () => getCachedCalendarEvents(initialRange.start, initialRange.end),
    [initialRange],
  );

  const [events, setEvents] = useState<ICalendarEvent[]>(
    () => initialCachedEvents ?? [],
  );
  const [eventsLoading, setEventsLoading] = useState(
    () => initialCachedEvents === null,
  );
  const [googleStatus, setGoogleStatus] =
    useState<ICalendarGoogleIntegrationStatus | null>(() =>
      getCachedGoogleCalendarStatus(),
    );
  const [googleSettingsOpen, setGoogleSettingsOpen] = useState(false);
  const [googleCalendarId, setGoogleCalendarId] = useState("primary");
  const [googleMutating, setGoogleMutating] = useState(false);
  const [googleSyncing, setGoogleSyncing] = useState(false);

  const activeFetchController = useRef<AbortController | null>(null);
  const currentFetchRequestId = useRef(0);
  const prefetchControllers = useRef<Set<AbortController>>(new Set());
  const statusMutationId = useRef(0);

  const invalidateCache = useCallback((start: Date, end: Date) => {
    deleteCachedCalendarEvents(start, end);
  }, []);

  const [startDate, setStartDate] = useState(() => initialRange.start);
  const [endDate, setEndDate] = useState(() => initialRange.end);

  const [viewEvent, setViewEvent] = useState<ICalendarEvent | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    title: string;
    place: string;
    date: string;
    isAllDay: boolean;
    kind: ICalendarEvent["kind"];
    status: ICalendarEvent["status"];
    notifyBySlack: boolean;
    notifyBeforeMinutes: number;
    links: EventLink[];
  }>({
    title: "",
    place: "",
    date: "",
    isAllDay: false,
    kind: "manual",
    status: "scheduled",
    notifyBySlack: false,
    notifyBeforeMinutes: 0,
    links: [],
  });
  const [editNewLink, setEditNewLink] = useState<EventLink>({
    label: "",
    url: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const replaceEventEverywhere = useCallback((event: ICalendarEvent) => {
    setViewEvent((current) => (current?._id === event._id ? event : current));
    setEvents((prev) =>
      prev.map((existing) => (existing._id === event._id ? event : existing)),
    );
    replaceCachedCalendarEvent(event);
  }, []);

  const removeEventEverywhere = useCallback((eventId: string) => {
    setViewEvent((current) => (current?._id === eventId ? null : current));
    setEvents((prev) => prev.filter((event) => event._id !== eventId));
    removeCachedCalendarEvent(eventId);
  }, []);

  const openViewEvent = useCallback((e: ICalendarEvent) => {
    setViewEvent(e);
    setEditing(false);
  }, []);

  const startEditing = useCallback(() => {
    if (!viewEvent) return;
    setEditForm({
      title: viewEvent.title,
      place: viewEvent.place ?? "",
      date: format(new Date(viewEvent.date), "yyyy-MM-dd'T'HH:mm"),
      isAllDay: viewEvent.isAllDay,
      kind: viewEvent.kind,
      status: viewEvent.status,
      notifyBySlack: viewEvent.notifyBySlack,
      notifyBeforeMinutes: viewEvent.notifyBeforeMinutes,
      links: viewEvent.links.map((l) => ({
        label: l.label,
        url: l.url,
        icon: l.icon,
      })),
    });
    setEditNewLink({ label: "", url: "" });
    setEditing(true);
  }, [viewEvent]);

  const saveEvent = useCallback(async () => {
    if (!viewEvent) return;
    setSaving(true);
    try {
      const result = await client.patch<{ event: ICalendarEvent }>(
        `calendar/${viewEvent._id}`,
        {
          title: editForm.title,
          place: editForm.place || undefined,
          date: new Date(editForm.date).toISOString(),
          calendarDate: editForm.date.slice(0, 10),
          isAllDay: editForm.isAllDay,
          kind: editForm.kind,
          status: editForm.status,
          notifyBySlack: editForm.notifyBySlack,
          notifyBeforeMinutes: editForm.notifyBeforeMinutes,
          links: editForm.links,
        },
      );
      invalidateCache(startDate, endDate);
      replaceEventEverywhere(result.event);
      setEditing(false);
    } catch (error) {
      console.error("Failed to save event:", error);
    } finally {
      setSaving(false);
    }
  }, [
    client,
    viewEvent,
    editForm,
    invalidateCache,
    startDate,
    endDate,
    replaceEventEverywhere,
  ]);

  const deleteViewedEvent = useCallback(async () => {
    if (!viewEvent || deleting) return;

    const eventId = viewEvent._id;
    setDeleting(true);
    try {
      await client.del<{ success: true }>(`calendar/${eventId}`);
      invalidateCache(startDate, endDate);
      removeEventEverywhere(eventId);
      setEditing(false);
      setDeleteDialogOpen(false);
      toast.success("Event deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete event",
      );
      console.error("Failed to delete event:", error);
    } finally {
      setDeleting(false);
    }
  }, [
    client,
    deleting,
    viewEvent,
    invalidateCache,
    startDate,
    endDate,
    removeEventEverywhere,
  ]);

  const changeStatus = useCallback(
    async (status: ICalendarEvent["status"]) => {
      if (!viewEvent || viewEvent.status === status) return;

      const previousEvent = viewEvent;
      const optimisticEvent = { ...viewEvent, status };
      const mutationId = statusMutationId.current + 1;
      statusMutationId.current = mutationId;
      replaceEventEverywhere(optimisticEvent);

      try {
        const result = await client.patch<{ event: ICalendarEvent }>(
          `calendar/${viewEvent._id}`,
          { status },
        );
        if (statusMutationId.current === mutationId) {
          replaceEventEverywhere(result.event);
        }
      } catch (error) {
        if (statusMutationId.current === mutationId) {
          replaceEventEverywhere(previousEvent);
        }
        console.error("Failed to update status:", error);
      }
    },
    [client, viewEvent, replaceEventEverywhere],
  );

  const [addingEvent, setAddingEvent] = useState(false);
  const [addForm, setAddForm] = useState({
    title: "",
    place: "",
    date: "",
    kind: "manual" as ICalendarEvent["kind"],
    notifyBySlack: false,
    isAllDay: false,
    notifyBeforeMinutes: 30,
    links: [] as EventLink[],
  });
  const [addNewLink, setAddNewLink] = useState<EventLink>({
    label: "",
    url: "",
  });
  const [addSaving, setAddSaving] = useState(false);

  const fetchGoogleStatus = useCallback(
    async (options: { skipCache?: boolean } = {}) => {
      try {
        const result = await fetchGoogleCalendarStatus(client, {
          skipCache: options.skipCache,
        });
        setGoogleStatus(result);
        setGoogleCalendarId(result.calendarId || "primary");
      } catch (error) {
        console.error("Failed to fetch Google Calendar status:", error);
      }
    },
    [client],
  );

  useEffect(() => {
    void fetchGoogleStatus();
  }, [fetchGoogleStatus]);

  const connectGoogleCalendar = useCallback(async () => {
    setGoogleMutating(true);
    try {
      const result = await client.post<{ url: string }>(
        "calendar/google/connect",
        {},
      );
      window.location.assign(result.url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to start Google Calendar connection",
      );
      setGoogleMutating(false);
    }
  }, [client]);

  const saveGoogleCalendarSettings = useCallback(async () => {
    setGoogleMutating(true);
    try {
      const result = await client.patch<CalendarGoogleStatusPatchResult>(
        "calendar/google",
        {
          calendarId: googleCalendarId || "primary",
          enabled: googleStatus?.enabled ?? true,
        },
      );
      setGoogleStatus((current) => {
        const nextStatus = {
          ...(current ?? result),
          ...result,
          connected: true,
          pendingSyncCount:
            result.pendingSyncCount ?? current?.pendingSyncCount ?? 0,
          failedSyncCount:
            result.failedSyncCount ?? current?.failedSyncCount ?? 0,
        };
        setCachedGoogleCalendarStatus(nextStatus);
        return nextStatus;
      });
      toast.success("Google Calendar settings saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save Google Calendar settings",
      );
    } finally {
      setGoogleMutating(false);
    }
  }, [client, googleCalendarId, googleStatus?.enabled]);

  const setGoogleEnabled = useCallback(
    async (enabled: boolean) => {
      setGoogleMutating(true);
      try {
        const result = await client.patch<CalendarGoogleStatusPatchResult>(
          "calendar/google",
          {
            enabled,
            calendarId: googleCalendarId || "primary",
          },
        );
        setGoogleStatus((current) => {
          const nextStatus = {
            ...(current ?? result),
            ...result,
            connected: true,
            pendingSyncCount:
              result.pendingSyncCount ?? current?.pendingSyncCount ?? 0,
            failedSyncCount:
              result.failedSyncCount ?? current?.failedSyncCount ?? 0,
          };
          setCachedGoogleCalendarStatus(nextStatus);
          return nextStatus;
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update Google Calendar",
        );
      } finally {
        setGoogleMutating(false);
      }
    },
    [client, googleCalendarId],
  );

  const disconnectGoogleCalendar = useCallback(async () => {
    if (!window.confirm("Disconnect Google Calendar?")) return;
    setGoogleMutating(true);
    try {
      await client.del<{ success: true }>("calendar/google");
      const disconnectedStatus = {
        connected: false,
        enabled: false,
        calendarId: "primary",
        scope: [],
        pendingSyncCount: 0,
        failedSyncCount: 0,
      };
      setGoogleStatus(disconnectedStatus);
      setCachedGoogleCalendarStatus(disconnectedStatus);
      setGoogleCalendarId("primary");
      setGoogleSettingsOpen(false);
      toast.success("Google Calendar disconnected");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to disconnect Google Calendar",
      );
    } finally {
      setGoogleMutating(false);
    }
  }, [client]);

  const syncExistingGoogleEvents = useCallback(async () => {
    setGoogleSyncing(true);
    try {
      const result = await client.post<{
        totalCount: number;
        syncedCount: number;
        failedCount: number;
        skippedCount: number;
      }>("calendar/google/sync", {
        start: new Date().toISOString(),
      });
      await fetchGoogleStatus({ skipCache: true });
      toast.success(
        `Pushed ${result.syncedCount} of ${result.totalCount} syncable events`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to sync existing events",
      );
    } finally {
      setGoogleSyncing(false);
    }
  }, [client, fetchGoogleStatus]);

  const retryGoogleCalendarSync = useCallback(async () => {
    setGoogleSyncing(true);
    try {
      const result = await client.post<{
        totalCount: number;
        syncedCount: number;
        failedCount: number;
        skippedCount: number;
      }>("calendar/google/retry", {});
      await fetchGoogleStatus({ skipCache: true });
      toast.success(
        `Retried ${result.totalCount} Google Calendar sync item${result.totalCount === 1 ? "" : "s"}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to retry sync",
      );
    } finally {
      setGoogleSyncing(false);
    }
  }, [client, fetchGoogleStatus]);

  const openAddEvent = useCallback((date?: Date) => {
    setAddForm({
      title: "",
      place: "",
      date: date
        ? format(date, "yyyy-MM-dd'T'HH:mm")
        : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      kind: "manual",
      notifyBySlack: false,
      isAllDay: false,
      notifyBeforeMinutes: 30,
      links: [],
    });
    setAddNewLink({ label: "", url: "" });
    setAddingEvent(true);
  }, []);

  const createEvent = useCallback(async () => {
    if (!addForm.title || !addForm.date) return;
    setAddSaving(true);
    try {
      const result = await client.post<{ event: ICalendarEvent }>("calendar", {
        title: addForm.title,
        place: addForm.place || undefined,
        date: new Date(addForm.date).toISOString(),
        calendarDate: addForm.date.slice(0, 10),
        isAllDay: false,
        kind: addForm.kind,
        status: "scheduled",
        notifyBySlack: addForm.notifyBySlack,
        notifyBeforeMinutes: addForm.notifyBeforeMinutes,
        links: addForm.links,
      });
      invalidateCache(startDate, endDate);
      setEvents((prev) => [...prev, result.event]);
      setAddingEvent(false);
    } catch (error) {
      console.error("Failed to create event:", error);
    } finally {
      setAddSaving(false);
    }
  }, [client, addForm, invalidateCache, startDate, endDate]);

  const [dayViewDate, setDayViewDate] = useState<Date | null>(null);

  const dayViewEvents = useMemo(() => {
    if (!dayViewDate) return [];
    return events
      .filter((e) => {
        const key =
          e.calendarDate ??
          `${new Date(e.date).getFullYear()}-${String(new Date(e.date).getMonth() + 1).padStart(2, "0")}-${String(new Date(e.date).getDate()).padStart(2, "0")}`;
        const dayKey = `${dayViewDate.getFullYear()}-${String(dayViewDate.getMonth() + 1).padStart(2, "0")}-${String(dayViewDate.getDate()).padStart(2, "0")}`;
        return key === dayKey;
      })
      .sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });
  }, [dayViewDate, events]);

  const openDayView = useCallback((date: Date) => {
    setDayViewDate(date);
  }, []);

  const fetchEvents = useCallback(
    async (
      start: Date,
      end: Date,
      options: { prefetch?: boolean; skipCache?: boolean } = {},
    ) => {
      const cachedEvents = getCachedCalendarEvents(start, end);
      if (!options.skipCache && cachedEvents) {
        if (!options.prefetch) {
          setEvents(cachedEvents);
          setEventsLoading(false);
        }
        return cachedEvents;
      }

      const controller = new AbortController();
      const requestId = options.prefetch
        ? null
        : currentFetchRequestId.current + 1;
      if (requestId !== null) {
        currentFetchRequestId.current = requestId;
        activeFetchController.current?.abort();
        activeFetchController.current = controller;
        setEventsLoading(true);
      } else {
        prefetchControllers.current.add(controller);
      }

      try {
        const result = await fetchCalendarEvents(client, start, end, {
          signal: controller.signal,
          skipCache: options.skipCache,
        });
        if (
          requestId !== null &&
          currentFetchRequestId.current === requestId &&
          !controller.signal.aborted
        ) {
          setEvents(result);
          setEventsLoading(false);
        }
        return result;
      } catch (error) {
        if (
          requestId !== null &&
          currentFetchRequestId.current === requestId &&
          !controller.signal.aborted
        ) {
          setEventsLoading(false);
        }
        if (!isAbortError(error)) {
          console.error("Failed to fetch calendar events:", error);
        }
        return null;
      } finally {
        if (requestId !== null) {
          if (activeFetchController.current === controller) {
            activeFetchController.current = null;
          }
        } else {
          prefetchControllers.current.delete(controller);
        }
      }
    },
    [client],
  );

  useEffect(() => {
    let disposed = false;

    fetchEvents(startDate, endDate).then(() => {
      if (disposed) return;
      const previousMonth = getCalendarMonthRange(startDate, -1);
      const nextMonth = getCalendarMonthRange(startDate, 1);
      void fetchEvents(previousMonth.start, previousMonth.end, {
        prefetch: true,
      });
      void fetchEvents(nextMonth.start, nextMonth.end, { prefetch: true });
    });

    return () => {
      disposed = true;
    };
  }, [fetchEvents, startDate, endDate]);

  useEffect(() => {
    return () => {
      activeFetchController.current?.abort();
      for (const controller of prefetchControllers.current) {
        controller.abort();
      }
      prefetchControllers.current.clear();
    };
  }, []);

  const handleMonthChange = useCallback((start: Date, end: Date) => {
    const cachedEvents = getCachedCalendarEvents(start, end);
    setStartDate(start);
    setEndDate(end);
    if (cachedEvents) {
      setEvents(cachedEvents);
      setEventsLoading(false);
    } else {
      setEventsLoading(true);
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<CalendarIcon className="size-4 text-muted-foreground" />}
        title="Calendar"
      >
        <Button
          onClick={() => {
            if (googleStatus?.connected) {
              setGoogleSettingsOpen(true);
            } else {
              void connectGoogleCalendar();
            }
          }}
          size="sm"
          variant={googleStatus?.lastSyncError ? "destructive" : "outline"}
          disabled={googleMutating}
          title={
            !googleStatus?.connected
              ? "Connect Google Calendar"
              : googleStatus.enabled
                ? "Google Calendar"
                : "Google Paused"
          }
        >
          {googleStatus?.lastSyncError ? <RefreshCw /> : <CalendarIcon />}
          <span className="hidden sm:inline">
            {!googleStatus?.connected
              ? "Connect Google Calendar"
              : googleStatus.enabled
                ? "Google Calendar"
                : "Google Paused"}
          </span>
        </Button>
        <Button
          onClick={() => {
            openAddEvent();
          }}
          size={"sm"}
          title="Add Event"
        >
          <Plus />
          <span className="hidden sm:inline">Add Event</span>
        </Button>
      </PageHeader>
      <div className="relative min-h-0 flex-1 overflow-y-auto pb-4">
        {eventsLoading && (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur">
              <Loader2 className="size-4 animate-spin" />
              Loading calendar
            </div>
          </div>
        )}
        <CalendarGrid
          events={events}
          onMonthChange={handleMonthChange}
          onEventClick={openViewEvent}
          onDayClick={openDayView}
        />
      </div>

      <Dialog open={googleSettingsOpen} onOpenChange={setGoogleSettingsOpen}>
        <DialogContent className="max-w-md">
          <div className="space-y-1.5">
            <DialogTitle>Google Calendar</DialogTitle>
            <DialogDescription>
              Two-way sync imports upcoming Google events and mirrors app
              events, meetings, flights, and birthdays back to Google.
            </DialogDescription>
          </div>

          <Separator />

          {!googleStatus?.connected ? (
            <Button
              onClick={connectGoogleCalendar}
              disabled={googleMutating}
              size="sm"
              className="w-full"
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              Connect Google Calendar
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Account</span>
                  <span className="truncate text-right">
                    {googleStatus.accountEmail || "Connected"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">State</span>
                  <Badge
                    variant={googleStatus.enabled ? "default" : "secondary"}
                  >
                    {googleStatus.enabled ? "Enabled" : "Paused"}
                  </Badge>
                </div>
                {googleStatus.lastSyncAt && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Last sync</span>
                    <span className="text-right">
                      {format(new Date(googleStatus.lastSyncAt), "PP p")}
                    </span>
                  </div>
                )}
              </div>

              {googleStatus.lastSyncError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                  {googleStatus.lastSyncError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="google-calendar-id">Calendar ID</Label>
                <Input
                  id="google-calendar-id"
                  value={googleCalendarId}
                  onChange={(event) => setGoogleCalendarId(event.target.value)}
                  placeholder="primary"
                />
              </div>

              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label htmlFor="google-enabled" className="text-sm">
                  Enable Google sync
                </Label>
                <Switch
                  id="google-enabled"
                  checked={googleStatus.enabled}
                  disabled={googleMutating}
                  onCheckedChange={(enabled) => void setGoogleEnabled(enabled)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={saveGoogleCalendarSettings}
                  disabled={googleMutating}
                >
                  <Settings className="h-3.5 w-3.5" />
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={syncExistingGoogleEvents}
                  disabled={googleSyncing || !googleStatus.enabled}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Push existing
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retryGoogleCalendarSync}
                  disabled={
                    googleSyncing ||
                    (!googleStatus.failedSyncCount &&
                      !googleStatus.pendingSyncCount)
                  }
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={disconnectGoogleCalendar}
                  disabled={googleMutating}
                >
                  <X className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={viewEvent !== null}
        onOpenChange={() => {
          setViewEvent(null);
          setEditing(false);
        }}
      >
        <DialogContent className="max-w-md">
          {!editing ? (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <DialogTitle className="leading-snug">
                    {viewEvent?.title}
                  </DialogTitle>
                  {viewEvent && (
                    <Badge variant="outline">
                      {getEventKindLabel(viewEvent.kind)}
                    </Badge>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="shrink-0 cursor-pointer">
                        <Badge
                          variant={
                            viewEvent?.status === "completed"
                              ? "default"
                              : viewEvent?.status === "canceled"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {viewEvent?.status}
                          <ChevronDown className="w-3 h-3" />
                        </Badge>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() => changeStatus("scheduled")}
                      >
                        Scheduled
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => changeStatus("completed")}
                      >
                        Completed
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => changeStatus("canceled")}
                      >
                        Canceled
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <DialogDescription className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  {viewEvent
                    ? viewEvent.isAllDay
                      ? `All day · ${format(new Date(`${viewEvent.calendarDate}T12:00:00`), "PPP")}`
                      : `${format(new Date(viewEvent.date), "p")} · ${format(new Date(viewEvent.date), "PPP")}`
                    : ""}
                </DialogDescription>
              </div>

              <Separator />

              <div className="space-y-2.5 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="w-4 h-4 shrink-0" />
                  <span>{viewEvent?.place || "No location specified"}</span>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground">
                  {viewEvent?.notifyBySlack ? (
                    <>
                      <Bell className="w-4 h-4 shrink-0" />
                      <span>
                        Slack{" "}
                        {formatDuration(
                          {
                            hours: Math.floor(
                              viewEvent.notifyBeforeMinutes / 60,
                            ),
                            minutes: viewEvent.notifyBeforeMinutes % 60,
                          },
                          { zero: false },
                        )}{" "}
                        before
                        {viewEvent.isNotificationSent
                          ? " · sent"
                          : " · pending"}
                      </span>
                    </>
                  ) : (
                    <>
                      <BellOff className="w-4 h-4 shrink-0" />
                      <span>No notifications</span>
                    </>
                  )}
                </div>
              </div>

              {(viewEvent?.links?.length ?? 0) > 0 && (
                <>
                  <Separator />
                  <div className="space-y-1.5">
                    {viewEvent?.links.map((link) => (
                      <a
                        key={link._id}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {link.icon ? (
                          <Image
                            src={link.icon}
                            alt=""
                            width={16}
                            height={16}
                            className="size-4 shrink-0"
                            unoptimized
                          />
                        ) : (
                          <ExternalLink className="w-4 h-4 shrink-0" />
                        )}
                        <span>{link.label}</span>
                      </a>
                    ))}
                  </div>
                </>
              )}

              <Separator />

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startEditing}
                  disabled={deleting}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit event
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogTitle>Edit event</DialogTitle>
              <DialogDescription className="sr-only">
                Edit event details
              </DialogDescription>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-title">Title</Label>
                  <Input
                    id="edit-title"
                    value={editForm.title}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, title: e.target.value }))
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select
                    value={editForm.kind}
                    onValueChange={(v) =>
                      setEditForm((f) => ({
                        ...f,
                        kind: v as ICalendarEvent["kind"],
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {editForm.kind === "holiday" && (
                        <SelectItem value="holiday">Holiday</SelectItem>
                      )}
                      {USER_EVENT_KIND_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        return (
                          <SelectItem key={option.value} value={option.value}>
                            <span className="flex items-center gap-2">
                              <Icon className="size-3.5" />
                              {option.label}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Date & time</Label>
                  <div className="flex items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="justify-start font-normal flex-1"
                        >
                          <CalendarDays className="w-4 h-4 shrink-0" />
                          {editForm.date
                            ? format(new Date(editForm.date), "PPP")
                            : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={
                            editForm.date ? new Date(editForm.date) : undefined
                          }
                          onSelect={(day) => {
                            if (!day) return;
                            const prev = editForm.date
                              ? new Date(editForm.date)
                              : new Date();
                            day.setHours(prev.getHours(), prev.getMinutes());
                            setEditForm((f) => ({
                              ...f,
                              date: format(day, "yyyy-MM-dd'T'HH:mm"),
                            }));
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    <Select
                      value={
                        editForm.date
                          ? String(new Date(editForm.date).getHours())
                          : "0"
                      }
                      onValueChange={(v) => {
                        const d = editForm.date
                          ? new Date(editForm.date)
                          : new Date();
                        d.setHours(Number(v));
                        setEditForm((f) => ({
                          ...f,
                          date: format(d, "yyyy-MM-dd'T'HH:mm"),
                        }));
                      }}
                    >
                      <SelectTrigger className="w-18">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" className="max-h-48">
                        {Array.from({ length: 24 }, (_, i) => String(i)).map(
                          (hour) => (
                            <SelectItem key={hour} value={hour}>
                              {hour.padStart(2, "0")}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">:</span>
                    <Select
                      value={
                        editForm.date
                          ? String(new Date(editForm.date).getMinutes())
                          : "0"
                      }
                      onValueChange={(v) => {
                        const d = editForm.date
                          ? new Date(editForm.date)
                          : new Date();
                        d.setMinutes(Number(v));
                        setEditForm((f) => ({
                          ...f,
                          date: format(d, "yyyy-MM-dd'T'HH:mm"),
                        }));
                      }}
                    >
                      <SelectTrigger className="w-18">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" className="max-h-48">
                        {Array.from({ length: 60 }, (_, i) => String(i)).map(
                          (minute) => (
                            <SelectItem key={minute} value={minute}>
                              {minute.padStart(2, "0")}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-all-day">All-day event</Label>
                  <Switch
                    id="edit-all-day"
                    checked={editForm.isAllDay}
                    onCheckedChange={(v) =>
                      setEditForm((f) => ({ ...f, isAllDay: v }))
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-place">Location</Label>
                  <Input
                    id="edit-place"
                    value={editForm.place}
                    placeholder="No location"
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, place: e.target.value }))
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select
                    value={editForm.status}
                    onValueChange={(v) =>
                      setEditForm((f) => ({
                        ...f,
                        status: v as ICalendarEvent["status"],
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="canceled">Canceled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-slack">Slack notification</Label>
                  <Switch
                    id="edit-slack"
                    checked={editForm.notifyBySlack}
                    onCheckedChange={(v) =>
                      setEditForm((f) => ({ ...f, notifyBySlack: v }))
                    }
                  />
                </div>

                {editForm.notifyBySlack && (
                  <div className="space-y-1.5">
                    <Label>Notify me</Label>
                    <Select
                      value={(() => {
                        const opts = getSmartNotificationOptions(editForm.date);
                        const cur = editForm.notifyBeforeMinutes.toString();
                        return opts.some((o) => o.value === cur)
                          ? cur
                          : (opts[0]?.value ?? "15");
                      })()}
                      onValueChange={(v) =>
                        setEditForm((f) => ({
                          ...f,
                          notifyBeforeMinutes: Number.parseInt(v, 10),
                        }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {getSmartNotificationOptions(editForm.date).map(
                          (opt, i) => (
                            <SelectItem
                              key={`${opt.value}-${i}`}
                              value={opt.value}
                            >
                              {opt.label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Links</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Label"
                      value={editNewLink.label}
                      onChange={(e) =>
                        setEditNewLink((l) => ({
                          ...l,
                          label: e.target.value,
                        }))
                      }
                      className="flex-1"
                    />
                    <Input
                      placeholder="https://..."
                      type="url"
                      value={editNewLink.url}
                      onChange={(e) =>
                        setEditNewLink((l) => ({ ...l, url: e.target.value }))
                      }
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="shrink-0"
                      disabled={!editNewLink.label || !editNewLink.url}
                      onClick={() => {
                        const icon =
                          getFaviconUrl(editNewLink.url) ?? undefined;
                        setEditForm((f) => ({
                          ...f,
                          links: [...f.links, { ...editNewLink, icon }],
                        }));
                        setEditNewLink({ label: "", url: "" });
                      }}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  {editForm.links.length > 0 && (
                    <div className="space-y-1">
                      {editForm.links.map((link, i) => (
                        <div
                          key={`${link.label}-${link.url}`}
                          className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
                        >
                          {link.icon ? (
                            <Image
                              src={link.icon}
                              alt=""
                              width={16}
                              height={16}
                              className="size-4 shrink-0"
                              unoptimized
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display =
                                  "none";
                              }}
                            />
                          ) : (
                            <LinkIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="flex-1 truncate">{link.label}</span>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground truncate max-w-32 text-xs"
                          >
                            {link.url}
                          </a>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="shrink-0 h-6 w-6"
                            onClick={() =>
                              setEditForm((f) => ({
                                ...f,
                                links: f.links.filter((_, j) => j !== i),
                              }))
                            }
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </Button>
                <Button size="sm" onClick={saveEvent} disabled={saving}>
                  <Check className="w-3.5 h-3.5" />
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {viewEvent?.title ?? "this event"}.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void deleteViewedEvent();
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={addingEvent} onOpenChange={setAddingEvent}>
        <DialogContent className="max-w-md">
          <DialogTitle>New event</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new calendar event
          </DialogDescription>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-title">Title</Label>
              <Input
                id="add-title"
                value={addForm.title}
                placeholder="Event title"
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={addForm.kind}
                onValueChange={(v) =>
                  setAddForm((f) => ({
                    ...f,
                    kind: v as ICalendarEvent["kind"],
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {USER_EVENT_KIND_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <SelectItem key={option.value} value={option.value}>
                        <span className="flex items-center gap-2">
                          <Icon className="size-3.5" />
                          {option.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Date & time</Label>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start font-normal flex-1"
                    >
                      <CalendarDays className="w-4 h-4 shrink-0" />
                      {addForm.date
                        ? format(new Date(addForm.date), "PPP")
                        : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={
                        addForm.date ? new Date(addForm.date) : undefined
                      }
                      onSelect={(day) => {
                        if (!day) return;
                        const prev = addForm.date
                          ? new Date(addForm.date)
                          : new Date();
                        day.setHours(prev.getHours(), prev.getMinutes());
                        setAddForm((f) => ({
                          ...f,
                          date: format(day, "yyyy-MM-dd'T'HH:mm"),
                        }));
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <Select
                  value={
                    addForm.date
                      ? String(new Date(addForm.date).getHours())
                      : "0"
                  }
                  onValueChange={(v) => {
                    const d = addForm.date
                      ? new Date(addForm.date)
                      : new Date();
                    d.setHours(Number(v));
                    setAddForm((f) => ({
                      ...f,
                      date: format(d, "yyyy-MM-dd'T'HH:mm"),
                    }));
                  }}
                >
                  <SelectTrigger className="w-18">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-48">
                    {Array.from({ length: 24 }, (_, i) => String(i)).map(
                      (hour) => (
                        <SelectItem key={hour} value={hour}>
                          {hour.padStart(2, "0")}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">:</span>
                <Select
                  value={
                    addForm.date
                      ? String(new Date(addForm.date).getMinutes())
                      : "0"
                  }
                  onValueChange={(v) => {
                    const d = addForm.date
                      ? new Date(addForm.date)
                      : new Date();
                    d.setMinutes(Number(v));
                    setAddForm((f) => ({
                      ...f,
                      date: format(d, "yyyy-MM-dd'T'HH:mm"),
                    }));
                  }}
                >
                  <SelectTrigger className="w-18">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-48">
                    {Array.from({ length: 60 }, (_, i) => String(i)).map(
                      (minute) => (
                        <SelectItem key={minute} value={minute}>
                          {minute.padStart(2, "0")}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-place">Location</Label>
              <Input
                id="add-place"
                value={addForm.place}
                placeholder="Optional"
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, place: e.target.value }))
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="add-slack">Slack notification</Label>
              <Switch
                id="add-slack"
                checked={addForm.notifyBySlack}
                onCheckedChange={(v) =>
                  setAddForm((f) => ({ ...f, notifyBySlack: v }))
                }
              />
            </div>

            {addForm.notifyBySlack && (
              <div className="space-y-1.5">
                <Label>Notify me</Label>
                <Select
                  value={(() => {
                    const opts = getSmartNotificationOptions(addForm.date);
                    const cur = addForm.notifyBeforeMinutes.toString();
                    return opts.some((o) => o.value === cur)
                      ? cur
                      : (opts[0]?.value ?? "15");
                  })()}
                  onValueChange={(v) =>
                    setAddForm((f) => ({
                      ...f,
                      notifyBeforeMinutes: Number.parseInt(v, 10),
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {getSmartNotificationOptions(addForm.date).map((opt, i) => (
                      <SelectItem key={`${opt.value}-${i}`} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Links</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Label"
                  value={addNewLink.label}
                  onChange={(e) =>
                    setAddNewLink((l) => ({ ...l, label: e.target.value }))
                  }
                  className="flex-1"
                />
                <Input
                  placeholder="https://..."
                  type="url"
                  value={addNewLink.url}
                  onChange={(e) =>
                    setAddNewLink((l) => ({ ...l, url: e.target.value }))
                  }
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="shrink-0"
                  disabled={!addNewLink.label || !addNewLink.url}
                  onClick={() => {
                    const icon = getFaviconUrl(addNewLink.url) ?? undefined;
                    setAddForm((f) => ({
                      ...f,
                      links: [...f.links, { ...addNewLink, icon }],
                    }));
                    setAddNewLink({ label: "", url: "" });
                  }}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {addForm.links.length > 0 && (
                <div className="space-y-1">
                  {addForm.links.map((link, i) => (
                    <div
                      key={`${link.label}-${link.url}`}
                      className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
                    >
                      {link.icon ? (
                        <Image
                          src={link.icon}
                          alt=""
                          width={16}
                          height={16}
                          className="size-4 shrink-0"
                          unoptimized
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                      ) : (
                        <LinkIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1 truncate">{link.label}</span>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground truncate max-w-32 text-xs"
                      >
                        {link.url}
                      </a>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="shrink-0 h-6 w-6"
                        onClick={() =>
                          setAddForm((f) => ({
                            ...f,
                            links: f.links.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <Separator />

          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddingEvent(false)}
              disabled={addSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={createEvent}
              disabled={addSaving || !addForm.title}
            >
              <Plus className="w-3.5 h-3.5" />
              {addSaving ? "Creating…" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dayViewDate !== null}
        onOpenChange={() => setDayViewDate(null)}
      >
        <DialogContent className="max-w-md">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <DialogTitle>
                {dayViewDate ? format(dayViewDate, "EEEE, MMMM d") : ""}
              </DialogTitle>
              <DialogDescription>
                {dayViewEvents.length === 0
                  ? "No events"
                  : `${dayViewEvents.length} event${dayViewEvents.length > 1 ? "s" : ""}`}
              </DialogDescription>
            </div>
          </div>

          {dayViewEvents.length > 0 && (
            <>
              <Separator />
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {dayViewEvents.map((event) => (
                  <button
                    type="button"
                    key={event._id}
                    onClick={() => {
                      setDayViewDate(null);
                      openViewEvent(event);
                    }}
                    className="flex items-center gap-3 w-full rounded-md px-2 py-1.5 text-left hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">
                        {event.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {event.isAllDay
                          ? "All day"
                          : format(new Date(event.date), "p")}
                      </span>
                    </div>
                    <Badge
                      variant={
                        event.status === "completed"
                          ? "default"
                          : event.status === "canceled"
                            ? "destructive"
                            : "secondary"
                      }
                      className="shrink-0"
                    >
                      {event.status}
                    </Badge>
                  </button>
                ))}
              </div>
            </>
          )}

          <Separator />

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDayViewDate(null);
              openAddEvent(dayViewDate ?? undefined);
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add event
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
