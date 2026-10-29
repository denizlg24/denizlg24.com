"use client";

import type {
  ICalendarEvent,
  ICalendarGoogleIntegrationStatus,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton, ConfirmDialog } from "@repo/ui/confirm-button";
import { DatePicker } from "@repo/ui/date-picker";
import { DateTimePicker } from "@repo/ui/date-time-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Spinner } from "@repo/ui/spinner";
import { Switch } from "@repo/ui/switch";
import { ToolbarSpacer } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { format, formatDuration } from "date-fns";
import {
  Bell,
  CalendarDays,
  CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Link as LinkIcon,
  MapPin,
  Plane,
  Plus,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FaGoogle } from "react-icons/fa6";
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
import {
  CalendarGrid,
  compareEvents,
  EVENT_KIND_ACCENT,
  EVENT_KIND_DOT,
  eventDateKey,
  toCalendarDateKey,
} from "./calendar-grid";
import { RecordDialog } from "./record-dialog";

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

interface EventFormState {
  title: string;
  place: string;
  /** `yyyy-MM-ddTHH:mm`, local. */
  date: string;
  isAllDay: boolean;
  kind: ICalendarEvent["kind"];
  status: ICalendarEvent["status"];
  notifyBySlack: boolean;
  notifyBeforeMinutes: number;
  links: EventLink[];
}

function emptyEventForm(date: string): EventFormState {
  return {
    title: "",
    place: "",
    date,
    isAllDay: false,
    kind: "manual",
    status: "scheduled",
    notifyBySlack: false,
    notifyBeforeMinutes: 30,
    links: [],
  };
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

const EVENT_KINDS: readonly ICalendarEvent["kind"][] = [
  "manual",
  "meeting",
  "flight",
  "holiday",
  "birthday",
];

const EVENT_STATUSES: readonly ICalendarEvent["status"][] = [
  "scheduled",
  "completed",
  "canceled",
];

const STATUS_LABEL: Record<ICalendarEvent["status"], string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  canceled: "Canceled",
};

const STATUS_BADGE: Record<
  ICalendarEvent["status"],
  "info" | "good" | "secondary"
> = {
  scheduled: "info",
  completed: "good",
  canceled: "secondary",
};

function isEventKind(value: string): value is ICalendarEvent["kind"] {
  return EVENT_KINDS.some((kind) => kind === value);
}

function isEventStatus(value: string): value is ICalendarEvent["status"] {
  return EVENT_STATUSES.some((status) => status === value);
}

function getEventKindLabel(kind: ICalendarEvent["kind"]) {
  if (kind === "meeting") return "Meeting";
  if (kind === "flight") return "Flight";
  if (kind === "birthday") return "Birthday";
  if (kind === "holiday") return "Holiday";
  return "Event";
}

function getSmartNotificationOptions(dateStr: string) {
  const date = dateStr ? new Date(dateStr) : new Date();
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
    const { message } = error;
    if (typeof message === "string") return message;
  }
  return "";
}

function isAbortError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return true;

  const message = getErrorMessage(error).toLowerCase();
  return message === "request cancelled" || message === "request canceled";
}

function formatNotifyLead(minutes: number) {
  if (minutes === 0) return "at start";
  return `${formatDuration(
    { hours: Math.floor(minutes / 60), minutes: minutes % 60 },
    { zero: false },
  )} before`;
}

function LinkFavicon({ icon }: { icon?: string }) {
  const [failed, setFailed] = useState(false);
  if (!icon || failed) return <LinkIcon />;
  return (
    <Image
      src={icon}
      alt=""
      width={16}
      height={16}
      className="size-4 shrink-0"
      unoptimized
      onError={() => setFailed(true)}
    />
  );
}

function LinksField({
  links,
  onChange,
}: {
  links: EventLink[];
  onChange: (links: EventLink[]) => void;
}) {
  const [draft, setDraft] = useState<EventLink>({ label: "", url: "" });
  const canAdd = Boolean(draft.label.trim() && draft.url.trim());
  const add = () => {
    if (!canAdd) return;
    onChange([
      ...links,
      {
        label: draft.label.trim(),
        url: draft.url.trim(),
        icon: getFaviconUrl(draft.url.trim()) ?? undefined,
      },
    ]);
    setDraft({ label: "", url: "" });
  };

  return (
    <div className="flex flex-col gap-2">
      {links.length > 0 && (
        <List>
          {links.map((link, index) => (
            <ListRow
              key={index}
              leading={<LinkFavicon icon={link.icon} />}
              title={link.label}
              description={link.url}
              trailing={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${link.label}`}
                  onClick={() => onChange(links.filter((_, j) => j !== index))}
                >
                  <X />
                </Button>
              }
            />
          ))}
        </List>
      )}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Label"
          aria-label="Link label"
          value={draft.label}
          onChange={(e) => setDraft((l) => ({ ...l, label: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAdd) {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1"
        />
        <Input
          placeholder="https://"
          aria-label="Link URL"
          type="url"
          value={draft.url}
          onChange={(e) => setDraft((l) => ({ ...l, url: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAdd) {
              e.preventDefault();
              add();
            }
          }}
          className="flex-[2]"
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Add link"
          disabled={!canAdd}
          onClick={add}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

function EventFormFields({
  idPrefix,
  form,
  setForm,
  showStatus,
}: {
  idPrefix: string;
  form: EventFormState;
  setForm: Dispatch<SetStateAction<EventFormState>>;
  showStatus: boolean;
}) {
  const notifyOptions = getSmartNotificationOptions(form.date);
  const currentLead = form.notifyBeforeMinutes.toString();
  const notifyValue = notifyOptions.some((o) => o.value === currentLead)
    ? currentLead
    : (notifyOptions[0]?.value ?? "15");

  return (
    <>
      <FormGrid>
        <FormField
          label="Title"
          htmlFor={`${idPrefix}-title`}
          className="sm:col-span-2"
        >
          <Input
            id={`${idPrefix}-title`}
            value={form.title}
            autoFocus
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </FormField>

        <FormField label="Type" htmlFor={`${idPrefix}-kind`}>
          <Select
            value={form.kind}
            onValueChange={(v) => {
              if (isEventKind(v)) setForm((f) => ({ ...f, kind: v }));
            }}
          >
            <SelectTrigger id={`${idPrefix}-kind`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {form.kind === "holiday" && (
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
        </FormField>

        {showStatus ? (
          <FormField label="Status" htmlFor={`${idPrefix}-status`}>
            <Select
              value={form.status}
              onValueChange={(v) => {
                if (isEventStatus(v)) setForm((f) => ({ ...f, status: v }));
              }}
            >
              <SelectTrigger id={`${idPrefix}-status`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {EVENT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : (
          <FormField label="Location" htmlFor={`${idPrefix}-place`}>
            <Input
              id={`${idPrefix}-place`}
              value={form.place}
              onChange={(e) =>
                setForm((f) => ({ ...f, place: e.target.value }))
              }
            />
          </FormField>
        )}

        <FormField label={form.isAllDay ? "Date" : "Date and time"}>
          {form.isAllDay ? (
            <DatePicker
              aria-label="Date"
              value={form.date.slice(0, 10) || undefined}
              onValueChange={(day) => {
                if (!day) return;
                setForm((f) => ({
                  ...f,
                  date: `${day}T${f.date.slice(11, 16) || "12:00"}`,
                }));
              }}
            />
          ) : (
            <DateTimePicker
              aria-label="Date"
              value={form.date || undefined}
              defaultTime="09:00"
              onValueChange={(value) => {
                if (value) setForm((f) => ({ ...f, date: value }));
              }}
            />
          )}
        </FormField>

        <FormField label="All day" htmlFor={`${idPrefix}-all-day`}>
          <div className="flex h-8 items-center">
            <Switch
              id={`${idPrefix}-all-day`}
              checked={form.isAllDay}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isAllDay: v }))}
            />
          </div>
        </FormField>

        {showStatus && (
          <FormField
            label="Location"
            htmlFor={`${idPrefix}-place`}
            className="sm:col-span-2"
          >
            <Input
              id={`${idPrefix}-place`}
              value={form.place}
              onChange={(e) =>
                setForm((f) => ({ ...f, place: e.target.value }))
              }
            />
          </FormField>
        )}

        <FormField label="Slack" htmlFor={`${idPrefix}-slack`}>
          <div className="flex h-8 items-center">
            <Switch
              id={`${idPrefix}-slack`}
              checked={form.notifyBySlack}
              onCheckedChange={(v) =>
                setForm((f) => ({ ...f, notifyBySlack: v }))
              }
            />
          </div>
        </FormField>

        {form.notifyBySlack && (
          <FormField label="Notify" htmlFor={`${idPrefix}-notify`}>
            <Select
              value={notifyValue}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  notifyBeforeMinutes: Number.parseInt(v, 10),
                }))
              }
            >
              <SelectTrigger id={`${idPrefix}-notify`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {notifyOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}
      </FormGrid>

      <FormField label="Links">
        <LinksField
          links={form.links}
          onChange={(links) => setForm((f) => ({ ...f, links }))}
        />
      </FormField>
    </>
  );
}

function CalendarChrome({
  actions,
  toolbar,
  children,
}: {
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<CalendarIcon />}
        title="Calendar"
      >
        {actions}
      </PageHeader>
      {toolbar ? <PageToolbar>{toolbar}</PageToolbar> : null}
      <PageBody>{children}</PageBody>
    </Page>
  );
}

export function CalendarSkeleton() {
  const now = new Date();
  return (
    <CalendarChrome
      actions={
        <Button size="sm" disabled>
          <Plus />
          Add
        </Button>
      }
      toolbar={
        <span className="px-1 text-sm font-medium text-accent-strong">
          {format(now, "MMMM yyyy")}
        </span>
      }
    >
      <CalendarGrid year={now.getFullYear()} month={now.getMonth()} />
    </CalendarChrome>
  );
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
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
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
  const [editForm, setEditForm] = useState<EventFormState>(() =>
    emptyEventForm(""),
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      date: viewEvent.isAllDay
        ? `${viewEvent.calendarDate}T12:00`
        : format(new Date(viewEvent.date), "yyyy-MM-dd'T'HH:mm"),
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
      toast.error(getErrorMessage(error) || "Failed to save event");
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
        toast.error(getErrorMessage(error) || "Failed to update status");
      }
    },
    [client, viewEvent, replaceEventEverywhere],
  );

  const [addingEvent, setAddingEvent] = useState(false);
  const [addForm, setAddForm] = useState<EventFormState>(() =>
    emptyEventForm(""),
  );
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
      setDisconnectDialogOpen(false);
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
    setAddForm(
      emptyEventForm(format(date ?? new Date(), "yyyy-MM-dd'T'HH:mm")),
    );
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
        isAllDay: addForm.isAllDay,
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
      toast.error(getErrorMessage(error) || "Failed to create event");
    } finally {
      setAddSaving(false);
    }
  }, [client, addForm, invalidateCache, startDate, endDate]);

  const [dayViewDate, setDayViewDate] = useState<Date | null>(null);

  const dayViewEvents = useMemo(() => {
    if (!dayViewDate) return [];
    const dayKey = toCalendarDateKey(dayViewDate);
    return events
      .filter((event) => eventDateKey(event) === dayKey)
      .sort(compareEvents);
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

  const googleButtonLabel = !googleStatus?.connected
    ? "Connect Google Calendar"
    : googleStatus.needsReauth
      ? "Reconnect Google Calendar"
      : googleStatus.enabled
        ? "Google Calendar"
        : "Google Paused";

  const shiftMonth = useCallback(
    (delta: number) => {
      const next = getCalendarMonthRange(startDate, delta);
      handleMonthChange(next.start, next.end);
    },
    [handleMonthChange, startDate],
  );

  const goToToday = useCallback(() => {
    const current = getCalendarMonthRange();
    handleMonthChange(current.start, current.end);
  }, [handleMonthChange]);

  const now = new Date();
  const isCurrentMonth =
    startDate.getFullYear() === now.getFullYear() &&
    startDate.getMonth() === now.getMonth();
  const scheduledCount = events.filter((e) => e.status === "scheduled").length;
  const googleAttention = Boolean(
    googleStatus?.needsReauth || googleStatus?.lastSyncError,
  );

  const closeView = () => {
    setViewEvent(null);
    setEditing(false);
  };

  return (
    <CalendarChrome
      actions={
        <>
          {eventsLoading && (
            <Spinner className="mr-1 size-3.5 text-muted-foreground" />
          )}
          <Button
            onClick={() => {
              if (googleStatus?.needsReauth || !googleStatus?.connected) {
                void connectGoogleCalendar();
              } else {
                setGoogleSettingsOpen(true);
              }
            }}
            size="sm"
            variant="ghost"
            disabled={googleMutating}
            title={googleButtonLabel}
            className={cn(googleAttention && "text-status-critical")}
          >
            {googleStatus?.lastSyncError ? <RefreshCw /> : <FaGoogle />}
            <span className="hidden sm:inline">{googleButtonLabel}</span>
          </Button>
          <Button size="sm" onClick={() => openAddEvent()} title="Add event">
            <Plus />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </>
      }
      toolbar={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-32 text-center text-sm font-medium tabular-nums text-accent-strong">
            {format(startDate, "MMMM yyyy")}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight />
          </Button>
          {!isCurrentMonth && (
            <Button variant="ghost" size="sm" onClick={goToToday}>
              Today
            </Button>
          )}
          <ToolbarSpacer />
          <span className="text-xs tabular-nums text-muted-foreground">
            {events.length} events · {scheduledCount} scheduled
          </span>
        </>
      }
    >
      <CalendarGrid
        year={startDate.getFullYear()}
        month={startDate.getMonth()}
        events={events}
        onEventClick={openViewEvent}
        onDayClick={openDayView}
      />

      <FormDialog
        open={googleSettingsOpen}
        onOpenChange={setGoogleSettingsOpen}
        title="Google Calendar"
        onSubmit={saveGoogleCalendarSettings}
        pending={googleMutating}
        submitDisabled={!googleStatus?.connected}
        footerStart={
          googleStatus?.connected ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => setDisconnectDialogOpen(true)}
              disabled={googleMutating}
            >
              Disconnect
            </Button>
          ) : null
        }
      >
        {!googleStatus?.connected ? (
          <EmptyState
            compact
            icon={<FaGoogle />}
            label="Not connected"
            action={
              <Button
                type="button"
                size="sm"
                onClick={() => void connectGoogleCalendar()}
                disabled={googleMutating}
              >
                Connect
              </Button>
            }
          />
        ) : (
          <>
            <Properties>
              <Property label="Account">
                {googleStatus.accountEmail || "Connected"}
              </Property>
              <Property label="State">
                <Badge
                  variant={
                    googleStatus.needsReauth
                      ? "critical"
                      : googleStatus.enabled
                        ? "good"
                        : "secondary"
                  }
                >
                  {googleStatus.needsReauth
                    ? "Reauth required"
                    : googleStatus.enabled
                      ? "Enabled"
                      : "Paused"}
                </Badge>
              </Property>
              <Property label="Last sync">
                {googleStatus.lastSyncAt ? (
                  <span className="tabular-nums">
                    {format(new Date(googleStatus.lastSyncAt), "PP p")}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Property>
              <Property label="Queue">
                <span className="tabular-nums">
                  {googleStatus.pendingSyncCount} pending ·{" "}
                  <span
                    className={cn(
                      googleStatus.failedSyncCount > 0 &&
                        "text-status-critical",
                    )}
                  >
                    {googleStatus.failedSyncCount} failed
                  </span>
                </span>
              </Property>
            </Properties>

            {googleStatus.lastSyncError && (
              <p className="text-xs text-destructive">
                {googleStatus.lastSyncError}
              </p>
            )}

            <FormGrid>
              <FormField label="Calendar ID" htmlFor="google-calendar-id">
                <Input
                  id="google-calendar-id"
                  value={googleCalendarId}
                  onChange={(event) => setGoogleCalendarId(event.target.value)}
                  placeholder="primary"
                />
              </FormField>
              <FormField label="Sync" htmlFor="google-enabled">
                <div className="flex h-8 items-center">
                  <Switch
                    id="google-enabled"
                    checked={googleStatus.enabled}
                    disabled={googleMutating}
                    onCheckedChange={(enabled) =>
                      void setGoogleEnabled(enabled)
                    }
                  />
                </div>
              </FormField>
            </FormGrid>

            <div className="flex flex-wrap items-center gap-2">
              {googleStatus.needsReauth && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void connectGoogleCalendar()}
                  disabled={googleMutating}
                >
                  <FaGoogle />
                  Reconnect
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={syncExistingGoogleEvents}
                disabled={googleSyncing || !googleStatus.enabled}
              >
                {googleSyncing ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <RefreshCw />
                )}
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
                <RefreshCw />
                Retry
              </Button>
            </div>
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={disconnectDialogOpen}
        onOpenChange={(open) => {
          if (!googleMutating) setDisconnectDialogOpen(open);
        }}
        title="Disconnect Google Calendar?"
        description="Synced events stay but stop updating."
        actionLabel="Disconnect"
        destructive
        pending={googleMutating}
        onConfirm={disconnectGoogleCalendar}
      />

      {viewEvent && (
        <RecordDialog
          open={!editing}
          onOpenChange={(open) => {
            if (!open) closeView();
          }}
          title={
            <span
              className={cn(
                viewEvent.status !== "scheduled" &&
                  "text-muted-foreground line-through",
              )}
            >
              {viewEvent.title}
            </span>
          }
          meta={
            <>
              <Badge
                variant="outline"
                className={cn("border-l-2", EVENT_KIND_ACCENT[viewEvent.kind])}
              >
                {getEventKindLabel(viewEvent.kind)}
              </Badge>
              {viewEvent.source && (
                <Badge variant="secondary">
                  {viewEvent.source.provider === "google" ? "Google" : "Synced"}
                </Badge>
              )}
            </>
          }
          footerStart={
            <ConfirmButton
              trigger={
                <Button
                  variant="ghost"
                  className="text-destructive"
                  disabled={deleting}
                >
                  {deleting && <Spinner className="size-3.5" />}
                  Delete
                </Button>
              }
              title={`Delete "${viewEvent.title}"?`}
              actionLabel="Delete"
              destructive
              pending={deleting}
              onConfirm={deleteViewedEvent}
            />
          }
          footer={
            <Button onClick={startEditing} disabled={deleting}>
              Edit
            </Button>
          }
        >
          <Properties>
            <Property label="Status">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <Badge variant={STATUS_BADGE[viewEvent.status]}>
                      {STATUS_LABEL[viewEvent.status]}
                      <ChevronDown />
                    </Badge>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {EVENT_STATUSES.map((status) => (
                    <DropdownMenuItem
                      key={status}
                      onClick={() => void changeStatus(status)}
                    >
                      {STATUS_LABEL[status]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Property>
            <Property icon={<CalendarDays />} label="Date">
              {format(
                new Date(`${eventDateKey(viewEvent)}T12:00:00`),
                "EEEE, d MMMM yyyy",
              )}
            </Property>
            <Property icon={<Clock />} label="Time">
              <span className="tabular-nums">
                {viewEvent.isAllDay
                  ? "All day"
                  : `${format(new Date(viewEvent.date), "HH:mm")}${viewEvent.endDate ? `–${format(new Date(viewEvent.endDate), "HH:mm")}` : ""}`}
              </span>
            </Property>
            <Property icon={<MapPin />} label="Location">
              {viewEvent.place || (
                <span className="text-muted-foreground">—</span>
              )}
            </Property>
            <Property icon={<Bell />} label="Slack">
              {viewEvent.notifyBySlack ? (
                <span>
                  {formatNotifyLead(viewEvent.notifyBeforeMinutes)}
                  <span className="text-muted-foreground">
                    {viewEvent.isNotificationSent ? " · sent" : " · pending"}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Property>
          </Properties>

          {viewEvent.links.length > 0 && (
            <Section title="Links" count={viewEvent.links.length}>
              <List>
                {viewEvent.links.map((link) => (
                  <a
                    key={link._id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ListRow
                      leading={<LinkFavicon icon={link.icon} />}
                      title={link.label}
                      description={link.url}
                      trailing={
                        <ExternalLink className="size-3.5 text-muted-foreground" />
                      }
                    />
                  </a>
                ))}
              </List>
            </Section>
          )}
        </RecordDialog>
      )}

      {viewEvent && editing && (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
          title="Edit event"
          size="lg"
          onSubmit={saveEvent}
          pending={saving}
          submitDisabled={!editForm.title.trim() || !editForm.date}
        >
          <EventFormFields
            idPrefix="edit"
            form={editForm}
            setForm={setEditForm}
            showStatus
          />
        </FormDialog>
      )}

      <FormDialog
        open={addingEvent}
        onOpenChange={setAddingEvent}
        title="New event"
        size="lg"
        submitLabel="Create"
        onSubmit={createEvent}
        pending={addSaving}
        submitDisabled={!addForm.title.trim() || !addForm.date}
      >
        <EventFormFields
          idPrefix="add"
          form={addForm}
          setForm={setAddForm}
          showStatus={false}
        />
      </FormDialog>

      {dayViewDate && (
        <RecordDialog
          open
          onOpenChange={(open) => {
            if (!open) setDayViewDate(null);
          }}
          title={format(dayViewDate, "EEEE, d MMMM")}
          meta={
            <span className="tabular-nums">
              {dayViewEvents.length}{" "}
              {dayViewEvents.length === 1 ? "event" : "events"}
            </span>
          }
          footer={
            <Button
              onClick={() => {
                setDayViewDate(null);
                openAddEvent(dayViewDate);
              }}
            >
              <Plus />
              Add
            </Button>
          }
        >
          {dayViewEvents.length === 0 ? (
            <EmptyState compact icon={<CalendarDays />} label="No events" />
          ) : (
            <List>
              {dayViewEvents.map((event) => (
                <ListRow
                  key={event._id}
                  leading={
                    <span
                      className={cn(
                        "h-4 w-0.5 rounded-full",
                        EVENT_KIND_DOT[event.kind],
                      )}
                    />
                  }
                  title={
                    <span
                      className={cn(
                        event.status !== "scheduled" &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      {event.title}
                    </span>
                  }
                  description={event.place || undefined}
                  meta={
                    event.isAllDay
                      ? "All day"
                      : format(new Date(event.date), "HH:mm")
                  }
                  trailing={
                    <Badge variant={STATUS_BADGE[event.status]}>
                      {STATUS_LABEL[event.status]}
                    </Badge>
                  }
                  onClick={() => {
                    setDayViewDate(null);
                    openViewEvent(event);
                  }}
                />
              ))}
            </List>
          )}
        </RecordDialog>
      )}
    </CalendarChrome>
  );
}
