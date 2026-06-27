"use client";

import type { ICalendarEvent } from "@repo/schemas";
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
  MapPin,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "../provider";
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

function getMonthRange(start: Date, monthOffset: number) {
  const year = start.getFullYear();
  const month = start.getMonth() + monthOffset;
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0, 23, 59, 59),
  };
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

  const [events, setEvents] = useState<ICalendarEvent[]>([]);

  const eventsCache = useRef<Map<string, ICalendarEvent[]>>(new Map());
  const activeFetchController = useRef<AbortController | null>(null);
  const currentFetchRequestId = useRef(0);
  const prefetchControllers = useRef<Set<AbortController>>(new Set());
  const statusMutationId = useRef(0);

  const cacheKey = useCallback(
    (start: Date, end: Date) => `${start.toISOString()}|${end.toISOString()}`,
    [],
  );

  const invalidateCache = useCallback(
    (start: Date, end: Date) => {
      eventsCache.current.delete(cacheKey(start, end));
    },
    [cacheKey],
  );

  const now = new Date();
  const [startDate, setStartDate] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const [endDate, setEndDate] = useState(
    () => new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
  );

  const [viewEvent, setViewEvent] = useState<ICalendarEvent | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    title: string;
    place: string;
    date: string;
    isAllDay: boolean;
    status: ICalendarEvent["status"];
    notifyBySlack: boolean;
    notifyBeforeMinutes: number;
    links: EventLink[];
  }>({
    title: "",
    place: "",
    date: "",
    isAllDay: false,
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

  const replaceEventEverywhere = useCallback((event: ICalendarEvent) => {
    setViewEvent((current) => (current?._id === event._id ? event : current));
    setEvents((prev) =>
      prev.map((existing) => (existing._id === event._id ? event : existing)),
    );

    for (const [key, cachedEvents] of eventsCache.current.entries()) {
      if (!cachedEvents.some((cachedEvent) => cachedEvent._id === event._id)) {
        continue;
      }
      eventsCache.current.set(
        key,
        cachedEvents.map((cachedEvent) =>
          cachedEvent._id === event._id ? event : cachedEvent,
        ),
      );
    }
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

  const openAddEvent = useCallback((date?: Date) => {
    setAddForm({
      title: "",
      place: "",
      date: date
        ? format(date, "yyyy-MM-dd'T'HH:mm")
        : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
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
        kind: "manual",
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
      const key = cacheKey(start, end);
      const cachedEvents = eventsCache.current.get(key);
      if (!options.skipCache && cachedEvents) {
        if (!options.prefetch) setEvents(cachedEvents);
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
      } else {
        prefetchControllers.current.add(controller);
      }

      try {
        const result = await client.get<{ events: ICalendarEvent[] }>(
          `calendar?start=${start.toISOString()}&end=${end.toISOString()}`,
          { signal: controller.signal },
        );
        eventsCache.current.set(key, result.events);
        if (
          requestId !== null &&
          currentFetchRequestId.current === requestId &&
          !controller.signal.aborted
        ) {
          setEvents(result.events);
        }
        return result.events;
      } catch (error) {
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
    [client, cacheKey],
  );

  useEffect(() => {
    let disposed = false;

    fetchEvents(startDate, endDate).then(() => {
      if (disposed) return;
      const previousMonth = getMonthRange(startDate, -1);
      const nextMonth = getMonthRange(startDate, 1);
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
    setStartDate(start);
    setEndDate(end);
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
            openAddEvent();
          }}
          size={"sm"}
        >
          <Plus />
          Add Event
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <CalendarGrid
          events={events}
          onMonthChange={handleMonthChange}
          onEventClick={openViewEvent}
          onDayClick={openDayView}
        />
      </div>

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

              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="w-3.5 h-3.5" />
                Edit event
              </Button>
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
