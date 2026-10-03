"use client";

import type {
  WorkHoursOverview,
  WorkJob,
  WorkPayPeriod,
  WorkSession,
} from "@repo/schemas";
import { BottomTabBar } from "@repo/ui/bottom-tab-bar";
import { Button } from "@repo/ui/button";
import { Calendar } from "@repo/ui/calendar";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CurrencySelect } from "@repo/ui/currency-select";
import { Input } from "@repo/ui/input";
import { NumericField } from "@repo/ui/numeric-field";
import { PageHeader } from "@repo/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Switch } from "@repo/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import {
  formatMinutes,
  majorToMinor,
  minorToMajor,
  sessionMinutes,
} from "@repo/utils";
import { endOfISOWeek, format, getISOWeek, startOfISOWeek } from "date-fns";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Clock,
  Coffee,
  History,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { FinancePayoutSchedule } from "../finance/finance-payout-schedule";
import { Empty, FieldRow, SectionHead } from "../finance/finance-primitives";
import { money, shortDay } from "../finance/finance-series";
import { useAdmin } from "../provider";
import {
  clockWork,
  createWorkJob,
  createWorkSession,
  deleteWorkSession,
  fetchWorkHours,
  fetchWorkSessions,
  updateWorkJob,
  updateWorkSession,
} from "./hours-data";
import { HoursSheet } from "./hours-sheet";
import { TimeField } from "./time-field";

type HoursTab = "clock" | "history" | "pay";

const TABS: { value: HoursTab; label: string; icon: typeof Clock }[] = [
  { value: "clock", label: "Clock", icon: Clock },
  { value: "history", label: "History", icon: History },
  { value: "pay", label: "Pay", icon: Wallet },
];

const HISTORY_WEEKS = 8;

const ACTION_LABEL = {
  in: "Check in",
  out: "Check out",
  break: "Break",
  resume: "Resume",
} as const;

type ClockAction = keyof typeof ACTION_LABEL;

// ---------------------------------------------------------------------------
// Local time helpers. Shifts are entered as wall-clock times on the device,
// which is where the shift happened.
// ---------------------------------------------------------------------------

function localDay(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function localTime(date: Date) {
  return format(date, "HH:mm");
}

function combine(day: string, time: string) {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year!, (month ?? 1) - 1, date ?? 1, hours ?? 0, minutes ?? 0);
}

/** A time on the shift's day, rolled past midnight when it reads earlier than
 *  the shift start — a 22:00–02:00 shift ends on the next day. */
function onShift(day: string, time: string, start: Date) {
  const value = combine(day, time);
  if (value < start) value.setDate(value.getDate() + 1);
  return value;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDay(date);
}

function clockface(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** A pill in a row of mutually exclusive choices. */
function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap tabular-nums transition-colors active:opacity-70",
        selected
          ? "border-foreground bg-foreground text-background"
          : "bg-background text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

function JobForm({
  job,
  onSaved,
}: {
  job: WorkJob | null;
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [name, setName] = useState(job?.name ?? "");
  const [currency, setCurrency] = useState(job?.currency ?? "DKK");
  const [rate, setRate] = useState(
    job ? String(minorToMajor(job.hourlyRateMinor, job.currency)) : "",
  );
  const [weekly, setWeekly] = useState(
    job?.expectedWeeklyHours !== undefined
      ? String(job.expectedWeeklyHours)
      : "",
  );
  const [breaksPaid, setBreaksPaid] = useState(job?.breaksPaid ?? false);
  const [timezone, setTimezone] = useState(
    job?.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "Europe/Copenhagen",
  );
  const [saving, setSaving] = useState(false);
  const ready = name.trim() && rate !== "";
  const idPrefix = job?.id ?? "new";

  async function save() {
    if (!ready) return;
    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        currency,
        hourlyRateMinor: Math.max(0, majorToMinor(Number(rate) || 0, currency)),
        breaksPaid,
        timezone: timezone.trim() || "Europe/Copenhagen",
      };
      const weeklyValue = weekly.trim() === "" ? null : Number(weekly);
      if (job) {
        await updateWorkJob(client, job.id, {
          ...input,
          expectedWeeklyHours: weeklyValue,
        });
      } else {
        await createWorkJob(client, {
          ...input,
          ...(weeklyValue !== null ? { expectedWeeklyHours: weeklyValue } : {}),
        });
      }
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <FieldRow label="Job" htmlFor={`${idPrefix}-name`}>
        <Input
          id={`${idPrefix}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Pandora"
          className="h-11 text-base md:h-9 md:text-sm"
        />
      </FieldRow>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,7rem)] gap-3">
        <FieldRow label="Hourly rate" className="min-w-0">
          <NumericField
            value={rate}
            onValueChange={(value) => setRate(value)}
            className="h-11 text-right text-base tabular-nums md:h-9 md:text-sm"
            placeholder="0.00"
          />
        </FieldRow>
        <FieldRow label="Currency" className="min-w-0">
          <CurrencySelect
            value={currency}
            onValueChange={setCurrency}
            className="h-11 md:h-9"
          />
        </FieldRow>
      </div>
      <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3">
        <FieldRow label="Hours / week" className="min-w-0">
          <NumericField
            value={weekly}
            onValueChange={(value) => setWeekly(value)}
            className="h-11 text-right text-base tabular-nums md:h-9 md:text-sm"
            placeholder="—"
          />
        </FieldRow>
        <FieldRow
          label="Timezone"
          htmlFor={`${idPrefix}-timezone`}
          className="min-w-0"
        >
          <Input
            id={`${idPrefix}-timezone`}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 text-base md:h-9 md:text-sm"
          />
        </FieldRow>
      </div>
      <label
        htmlFor={`${idPrefix}-breaks-paid`}
        className="flex h-11 items-center justify-between gap-3 text-sm"
      >
        Paid breaks
        <Switch
          id={`${idPrefix}-breaks-paid`}
          checked={breaksPaid}
          onCheckedChange={setBreaksPaid}
        />
      </label>
      <Button
        className="h-11 w-full md:h-9"
        disabled={saving || !ready}
        onClick={() => void save()}
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        {job ? "Save job" : "Add job"}
      </Button>
    </div>
  );
}

function JobsSheet({
  open,
  onOpenChange,
  jobs,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: WorkJob[];
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [editing, setEditing] = useState<string | "new" | null>(
    jobs.length === 1 ? (jobs[0]?.id ?? null) : null,
  );

  return (
    <HoursSheet open={open} onOpenChange={onOpenChange} title="Jobs" compact>
      <div className="space-y-6">
        <div className="divide-y border-b">
          {jobs.map((row) => {
            const expanded = editing === row.id;
            return (
              <div key={row.id}>
                <div className="flex min-h-14 items-center gap-3">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left"
                    onClick={() => setEditing(expanded ? null : row.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "truncate text-sm font-medium",
                          row.status === "archived" && "text-muted-foreground",
                        )}
                      >
                        {row.name}
                      </div>
                      <div className="text-[11px] tabular-nums text-muted-foreground">
                        {money(row.hourlyRateMinor, row.currency)}/h
                        {row.expectedWeeklyHours !== undefined &&
                          ` · ${row.expectedWeeklyHours} h/wk`}
                        {row.status === "archived" && " · archived"}
                      </div>
                    </div>
                    <ChevronRight
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        expanded && "rotate-90",
                      )}
                    />
                  </button>
                  <Switch
                    aria-label={`${row.name} active`}
                    checked={row.status === "active"}
                    onCheckedChange={async (checked) => {
                      try {
                        await updateWorkJob(client, row.id, {
                          status: checked ? "active" : "archived",
                        });
                        await onSaved();
                      } catch (error) {
                        toast.error(errorMessage(error, "Update failed"));
                      }
                    }}
                  />
                </div>
                {expanded && (
                  <div className="pt-1 pb-5">
                    <JobForm
                      job={row}
                      onSaved={async () => {
                        await onSaved();
                        toast.success("Saved");
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {editing === "new" ? (
          <div className="space-y-3">
            <SectionHead label="New job" />
            <JobForm
              job={null}
              onSaved={async () => {
                await onSaved();
                setEditing(null);
                toast.success("Added");
              }}
            />
          </div>
        ) : (
          <Button
            variant="outline"
            className="h-11 w-full md:h-9"
            onClick={() => setEditing("new")}
          >
            <Plus className="size-4" />
            Job
          </Button>
        )}
      </div>
    </HoursSheet>
  );
}

// ---------------------------------------------------------------------------
// Shift editor
// ---------------------------------------------------------------------------

interface BreakDraft {
  key: string;
  start: string;
  end: string;
}

const RECENT_DAYS = 7;

/** The week behind today as one-tap chips, which is where nearly every
 *  forgotten shift lives; anything older goes through the calendar. */
function DayStrip({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const days = useMemo(
    () =>
      Array.from({ length: RECENT_DAYS }, (_, offset) => {
        const iso = daysAgo(offset);
        const label =
          offset === 0
            ? "Today"
            : offset === 1
              ? "Yesterday"
              : format(combine(iso, "12:00"), "EEE d");
        return { iso, label };
      }),
    [],
  );
  const older = !days.some((day) => day.iso === value);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void value;
    strip.current
      ?.querySelector("[aria-pressed=true]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);

  return (
    <div
      ref={strip}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {older && (
        <Chip selected onClick={() => setCalendarOpen(true)}>
          {format(combine(value, "12:00"), "EEE d MMM")}
        </Chip>
      )}
      {days.map((day) => (
        <Chip
          key={day.iso}
          selected={day.iso === value}
          onClick={() => onValueChange(day.iso)}
        >
          {day.label}
        </Chip>
      ))}
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Pick a day"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border text-muted-foreground active:opacity-70"
          >
            <CalendarDays className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            mode="single"
            autoFocus
            selected={combine(value, "12:00")}
            defaultMonth={combine(value, "12:00")}
            disabled={{ after: new Date() }}
            onSelect={(next) => {
              if (!next) return;
              onValueChange(localDay(next));
              setCalendarOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TimeRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function SessionSheet({
  open,
  onOpenChange,
  session,
  jobs,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null adds a shift. */
  session: WorkSession | null;
  jobs: WorkJob[];
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const start = session ? new Date(session.start) : null;
  const end = session?.end ? new Date(session.end) : null;
  const activeJobs = jobs.filter(
    (job) => job.status === "active" || job.id === session?.jobId,
  );
  const [jobId, setJobId] = useState(session?.jobId ?? activeJobs[0]?.id ?? "");
  const [day, setDay] = useState(
    start ? localDay(start) : localDay(new Date()),
  );
  const [startTime, setStartTime] = useState(
    start ? localTime(start) : "09:00",
  );
  const [endTime, setEndTime] = useState(
    end ? localTime(end) : session ? "" : "17:00",
  );
  const [breaks, setBreaks] = useState<BreakDraft[]>(() =>
    (session?.breaks ?? []).map((item, index) => ({
      key: String(index),
      start: localTime(new Date(item.start)),
      end: item.end ? localTime(new Date(item.end)) : "",
    })),
  );
  const [note, setNote] = useState(session?.note ?? "");
  const [saving, setSaving] = useState(false);

  const job = jobs.find((row) => row.id === jobId);
  const preview = useMemo(() => {
    if (!startTime) return null;
    const shiftStart = combine(day, startTime);
    const shiftEnd = endTime ? onShift(day, endTime, shiftStart) : undefined;
    return sessionMinutes(
      {
        start: shiftStart,
        end: shiftEnd,
        breaks: breaks
          .filter((item) => item.start)
          .map((item) => ({
            start: onShift(day, item.start, shiftStart),
            end: item.end ? onShift(day, item.end, shiftStart) : undefined,
          })),
      },
      job?.breaksPaid ?? false,
    );
  }, [day, startTime, endTime, breaks, job?.breaksPaid]);

  const overnight =
    Boolean(startTime && endTime) &&
    combine(day, endTime) < combine(day, startTime);

  function updateBreak(key: string, patch: Partial<BreakDraft>) {
    setBreaks((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  async function save() {
    if (!jobId || !startTime) return;
    setSaving(true);
    try {
      const shiftStart = combine(day, startTime);
      const shiftEnd = endTime ? onShift(day, endTime, shiftStart) : undefined;
      const breakRows = breaks
        .filter((item) => item.start)
        .map((item) => ({
          start: onShift(day, item.start, shiftStart).toISOString(),
          end: item.end
            ? onShift(day, item.end, shiftStart).toISOString()
            : undefined,
        }));
      if (session) {
        await updateWorkSession(client, session.id, {
          jobId,
          start: shiftStart.toISOString(),
          end: shiftEnd ? shiftEnd.toISOString() : null,
          breaks: breakRows,
          note: note.trim() || null,
        });
      } else {
        await createWorkSession(client, {
          jobId,
          start: shiftStart.toISOString(),
          end: shiftEnd?.toISOString(),
          breaks: breakRows,
          note: note.trim() || undefined,
        });
      }
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <HoursSheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        session ? format(combine(session.day, "12:00"), "EEE d MMM") : "Shift"
      }
      action={{
        label: session ? "Save" : "Add",
        onClick: () => void save(),
        disabled: !jobId || !startTime,
        pending: saving,
      }}
    >
      <div className="space-y-7">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-4xl font-semibold tabular-nums tracking-tight">
            {preview ? formatMinutes(preview.workedMinutes) : "—"}
            <span className="ml-1 text-base font-normal text-muted-foreground">
              h
            </span>
          </div>
          <div className="min-w-0 text-right text-xs tabular-nums text-muted-foreground">
            {preview && job && (
              <div className="font-medium text-foreground">
                {money(
                  Math.round(
                    (preview.workedMinutes * job.hourlyRateMinor) / 60,
                  ),
                  job.currency,
                )}
              </div>
            )}
            <div>
              {[
                !endTime ? "open" : undefined,
                overnight ? "ends next day" : undefined,
                preview && preview.breakMinutes > 0
                  ? `break ${formatMinutes(preview.breakMinutes)}`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>

        {activeJobs.length > 1 && (
          <FieldRow label="Job">
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger className="h-11! w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activeJobs.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
        )}

        <div className="space-y-2">
          <SectionHead label="Day" />
          <DayStrip value={day} onValueChange={setDay} />
        </div>

        <div className="space-y-3">
          <SectionHead label="Time" />
          <TimeRow label="Start">
            <TimeField
              value={startTime}
              onValueChange={setStartTime}
              aria-label="Start"
            />
          </TimeRow>
          <TimeRow label="End">
            <TimeField
              value={endTime}
              onValueChange={setEndTime}
              fallback={startTime}
              placeholder="Open"
              clearable={Boolean(session)}
              aria-label="End"
            />
          </TimeRow>
        </div>

        <div className="space-y-3">
          <SectionHead label="Breaks">
            <Button
              size="sm"
              variant="ghost"
              className="-mr-2 h-8"
              onClick={() =>
                setBreaks((current) => [
                  ...current,
                  {
                    key: Math.random().toString(36).slice(2),
                    start: "12:00",
                    end: "12:30",
                  },
                ])
              }
            >
              <Plus className="size-3.5" />
              Break
            </Button>
          </SectionHead>
          {breaks.map((item, index) => (
            <div key={item.key} className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  Break {index + 1}
                  {item.start &&
                    item.end &&
                    ` · ${formatMinutes(
                      Math.max(
                        0,
                        Math.round(
                          (onShift(
                            day,
                            item.end,
                            combine(day, item.start),
                          ).getTime() -
                            combine(day, item.start).getTime()) /
                            60_000,
                        ),
                      ),
                    )}`}
                </span>
                <button
                  type="button"
                  aria-label={`Remove break ${index + 1}`}
                  onClick={() =>
                    setBreaks((current) =>
                      current.filter((row) => row.key !== item.key),
                    )
                  }
                  className="-mr-1 flex size-8 items-center justify-center rounded-md active:bg-muted"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TimeField
                  value={item.start}
                  onValueChange={(value) =>
                    updateBreak(item.key, { start: value })
                  }
                  step={5}
                  aria-label={`Break ${index + 1} start`}
                />
                <TimeField
                  value={item.end}
                  onValueChange={(value) =>
                    updateBreak(item.key, { end: value })
                  }
                  fallback={item.start}
                  placeholder="Open"
                  step={5}
                  aria-label={`Break ${index + 1} end`}
                />
              </div>
            </div>
          ))}
        </div>

        <FieldRow label="Note" htmlFor="shift-note">
          <Textarea
            id="shift-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="min-h-11 text-base md:text-sm"
          />
        </FieldRow>

        {session && (
          <ConfirmButton
            title="Delete shift?"
            actionLabel="Delete"
            onConfirm={async () => {
              try {
                await deleteWorkSession(client, session.id);
                onOpenChange(false);
                await onSaved();
              } catch (error) {
                toast.error(errorMessage(error, "Delete failed"));
              }
            }}
            trigger={
              <Button
                variant="ghost"
                className="h-11 w-full text-status-critical md:h-9"
              >
                <Trash2 className="size-4" />
                Delete shift
              </Button>
            }
          />
        )}
      </div>
    </HoursSheet>
  );
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

const AGO_MINUTES = [5, 15, 30, 60];

function EarlierSheet({
  open,
  onOpenChange,
  actions,
  initial,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: readonly ClockAction[];
  initial: ClockAction;
  pending: boolean;
  onConfirm: (action: ClockAction, at: Date) => Promise<void>;
}) {
  const [action, setAction] = useState(initial);
  const [time, setTime] = useState(() => localTime(new Date()));

  // A time later than now meant yesterday evening.
  const at = useMemo(() => {
    if (!time) return null;
    const value = combine(localDay(new Date()), time);
    if (value > new Date()) value.setDate(value.getDate() - 1);
    return value;
  }, [time]);
  const minutesAgo = at
    ? Math.round((Date.now() - at.getTime()) / 60_000)
    : null;

  return (
    <HoursSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Earlier"
      compact
      footer={
        <Button
          className="h-12 w-full text-base"
          disabled={pending || !at}
          onClick={async () => {
            if (!at) return;
            await onConfirm(action, at);
            onOpenChange(false);
          }}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {ACTION_LABEL[action]} at {time}
          {at && localDay(at) !== localDay(new Date()) && " yesterday"}
        </Button>
      }
    >
      <div className="space-y-5">
        {actions.length > 1 && (
          <div className="grid grid-flow-col gap-1 rounded-lg bg-muted p-1">
            {actions.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={action === value}
                onClick={() => setAction(value)}
                className={cn(
                  "h-9 rounded-md text-sm font-medium transition-colors",
                  action === value
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {ACTION_LABEL[value]}
              </button>
            ))}
          </div>
        )}
        <TimeField
          value={time}
          onValueChange={setTime}
          step={5}
          size="lg"
          aria-label="Time"
        />
        <div className="grid grid-cols-4 gap-2">
          {AGO_MINUTES.map((minutes) => (
            <Chip
              key={minutes}
              selected={minutesAgo === minutes}
              onClick={() =>
                setTime(localTime(new Date(Date.now() - minutes * 60_000)))
              }
              className="px-0"
            >
              −{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
            </Chip>
          ))}
        </div>
      </div>
    </HoursSheet>
  );
}

function Stat({ label, minutes }: { label: string; minutes: number }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight">
        {formatMinutes(minutes)}
      </div>
    </div>
  );
}

function PayPeriodSummary({ period }: { period: WorkPayPeriod }) {
  const { routes } = useAdmin();
  return (
    <div className="space-y-3">
      <SectionHead label={period.ruleName}>
        <Link
          href={routes.finance.rule(period.ruleId)}
          aria-label="Open in Finance"
          className="-m-2 flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" />
        </Link>
      </SectionHead>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[26px] font-semibold leading-none tabular-nums tracking-tight text-status-good">
            {money(period.netMinor, period.currency)}
          </div>
          <div className="mt-1.5 truncate text-[11px] tabular-nums text-muted-foreground">
            gross {money(period.grossMinor, period.currency)} · pays{" "}
            {shortDay(period.payoutDate)}
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          <div>
            {shortDay(period.periodStart)} – {shortDay(period.periodEnd)}
            {period.partial && " · partial"}
          </div>
          <div>
            <span className="text-foreground">
              {formatMinutes(period.loggedMinutes)}
            </span>
            {period.projectedMinutes !== period.loggedMinutes &&
              ` → ${formatMinutes(period.projectedMinutes)}`}{" "}
            h
          </div>
        </div>
      </div>
    </div>
  );
}

function ClockTab({
  overview,
  onChanged,
  onEditJobs,
}: {
  overview: WorkHoursOverview;
  onChanged: () => Promise<void>;
  onEditJobs: () => void;
}) {
  const { client } = useAdmin();
  const active = overview.active;
  const activeJobs = overview.jobs.filter((job) => job.status === "active");
  const job = active
    ? overview.jobs.find((row) => row.id === active.jobId)
    : undefined;
  const openBreak = active?.breaks.find((item) => !item.end);
  const now = useNow(Boolean(active));
  const [pending, setPending] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [earlierOpen, setEarlierOpen] = useState(false);

  // Worked time on the running shift, to the second, derived exactly as the
  // server does so the figure never jumps when the overview reloads.
  const runningMs = useMemo(() => {
    if (!active) return 0;
    const start = new Date(active.start).getTime();
    let breakMs = 0;
    for (const item of active.breaks) {
      const breakStart = new Date(item.start).getTime();
      const breakEnd = item.end ? new Date(item.end).getTime() : now.getTime();
      breakMs += Math.max(0, breakEnd - breakStart);
    }
    const total = now.getTime() - start;
    return job?.breaksPaid ? total : total - breakMs;
  }, [active, now, job?.breaksPaid]);

  const todayMinutes = active
    ? overview.today.workedMinutes -
      active.workedMinutes +
      Math.floor(runningMs / 60_000)
    : overview.today.workedMinutes;

  async function act(action: ClockAction, at?: Date) {
    if (pending) return;
    setPending(action);
    try {
      await clockWork(client, {
        action,
        jobId: action === "in" ? jobId : undefined,
        at: at?.toISOString(),
      });
      await onChanged();
    } catch (error) {
      toast.error(errorMessage(error, "Failed"));
    } finally {
      setPending(null);
    }
  }

  if (activeJobs.length === 0 && !active) {
    return (
      <div className="mx-auto max-w-sm space-y-4 pt-2">
        <SectionHead label="Job" />
        <JobForm job={null} onSaved={onChanged} />
      </div>
    );
  }

  const primary: "in" | "out" = active ? "out" : "in";
  const status = !active
    ? "Off"
    : openBreak
      ? `Break · ${localTime(new Date(openBreak.start))}`
      : `In · ${localTime(new Date(active.start))}`;
  const earlierActions: readonly ClockAction[] = active
    ? openBreak
      ? ["resume", "out"]
      : ["break", "out"]
    : ["in"];

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-5 pt-2">
        <div className="flex max-w-full items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              !active
                ? "bg-muted-foreground/40"
                : openBreak
                  ? "bg-status-warning"
                  : "bg-status-good",
            )}
          />
          <span className="truncate">
            {status}
            {job && activeJobs.length > 1 && ` · ${job.name}`}
          </span>
        </div>

        <div className="text-center">
          <div
            className={cn(
              "text-6xl font-semibold tabular-nums tracking-tight",
              openBreak && "text-muted-foreground",
            )}
          >
            {active ? clockface(runningMs) : formatMinutes(todayMinutes)}
          </div>
          <div className="mt-1 text-xs tabular-nums text-muted-foreground">
            {active ? `today ${formatMinutes(todayMinutes)}` : "today"}
          </div>
        </div>

        {!active && activeJobs.length > 1 && (
          <Select value={jobId ?? activeJobs[0]?.id} onValueChange={setJobId}>
            <SelectTrigger className="h-10! w-full max-w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activeJobs.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <button
          type="button"
          disabled={Boolean(pending)}
          onClick={() => void act(primary)}
          className={cn(
            "flex size-40 select-none items-center justify-center rounded-full text-2xl font-semibold tracking-tight transition-transform active:scale-95 disabled:opacity-60 [-webkit-tap-highlight-color:transparent]",
            primary === "in"
              ? "bg-foreground text-background shadow-lg"
              : "border-2 border-foreground bg-background text-foreground",
          )}
        >
          {pending === primary ? (
            <Loader2 className="size-7 animate-spin" />
          ) : (
            ACTION_LABEL[primary]
          )}
        </button>

        <div
          className={cn(
            "grid w-full max-w-72 gap-2",
            active ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {active && (
            <Button
              variant="outline"
              disabled={Boolean(pending)}
              onClick={() => void act(openBreak ? "resume" : "break")}
              className="h-11"
            >
              {pending === "break" || pending === "resume" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Coffee className="size-4" />
              )}
              {openBreak ? "Resume" : "Break"}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={Boolean(pending)}
            onClick={() => setEarlierOpen(true)}
            className="h-11 text-muted-foreground"
          >
            <Clock className="size-4" />
            Earlier
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 border-y py-4">
        <Stat label="Today" minutes={todayMinutes} />
        <Stat
          label="Week"
          minutes={
            overview.week.workedMinutes -
            overview.today.workedMinutes +
            todayMinutes
          }
        />
        <Stat
          label="Month"
          minutes={
            overview.month.workedMinutes -
            overview.today.workedMinutes +
            todayMinutes
          }
        />
      </div>

      {overview.payPeriods.map((period) => (
        <PayPeriodSummary key={period.ruleId} period={period} />
      ))}

      {activeJobs.length > 0 && overview.payPeriods.length === 0 && (
        <button
          type="button"
          onClick={onEditJobs}
          className="w-full text-center text-[11px] tabular-nums text-muted-foreground"
        >
          {activeJobs
            .map(
              (row) =>
                `${row.name} · ${money(row.hourlyRateMinor, row.currency)}/h`,
            )
            .join(" · ")}
        </button>
      )}

      {earlierOpen && (
        <EarlierSheet
          open
          onOpenChange={setEarlierOpen}
          actions={earlierActions}
          initial={active ? (openBreak ? "resume" : "out") : "in"}
          pending={Boolean(pending)}
          onConfirm={(action, at) => act(action, at)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

interface HistoryWeek {
  key: string;
  label: string;
  range: string;
  minutes: number;
  days: [string, WorkSession[]][];
}

function groupHistory(sessions: WorkSession[]): HistoryWeek[] {
  const byDay = new Map<string, WorkSession[]>();
  for (const session of sessions) {
    const list = byDay.get(session.day) ?? [];
    list.push(session);
    byDay.set(session.day, list);
  }
  const weeks = new Map<string, HistoryWeek>();
  for (const [day, rows] of [...byDay.entries()].sort(([a], [b]) =>
    b.localeCompare(a),
  )) {
    rows.sort((a, b) => b.start.localeCompare(a.start));
    const date = combine(day, "12:00");
    const monday = startOfISOWeek(date);
    const key = localDay(monday);
    let week = weeks.get(key);
    if (!week) {
      week = {
        key,
        label: `Week ${getISOWeek(date)}`,
        range: `${format(monday, "d MMM")} – ${format(endOfISOWeek(date), "d MMM")}`,
        minutes: 0,
        days: [],
      };
      weeks.set(key, week);
    }
    week.minutes += rows.reduce((sum, row) => sum + row.workedMinutes, 0);
    week.days.push([day, rows]);
  }
  return [...weeks.values()];
}

function HistoryTab({
  jobs,
  revision,
  onChanged,
}: {
  jobs: WorkJob[];
  revision: number;
  onChanged: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [weeks, setWeeks] = useState(HISTORY_WEEKS);
  const [sessions, setSessions] = useState<WorkSession[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<{
    session: WorkSession | null;
  } | null>(null);
  const jobName = new Map(jobs.map((job) => [job.id, job.name]));
  const multipleJobs = jobs.length > 1;

  const load = useCallback(async () => {
    try {
      setSessions(
        await fetchWorkSessions(client, { from: daysAgo(weeks * 7) }),
      );
    } catch (error) {
      toast.error(errorMessage(error, "History failed"));
    } finally {
      setLoadingMore(false);
    }
  }, [client, weeks]);

  useEffect(() => {
    void revision;
    void load();
  }, [load, revision]);

  const grouped = useMemo(() => groupHistory(sessions ?? []), [sessions]);

  const total = (sessions ?? []).reduce(
    (sum, row) => sum + row.workedMinutes,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate text-[11px] tabular-nums text-muted-foreground">
          {weeks} weeks · {formatMinutes(total)} h
        </div>
        <Button
          variant="outline"
          className="h-10 shrink-0"
          onClick={() => setEditing({ session: null })}
        >
          <Plus className="size-4" />
          Shift
        </Button>
      </div>

      {sessions === null ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-12 w-full" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <Empty label="No shifts" />
      ) : (
        <div className="space-y-8">
          {grouped.map((week) => (
            <section key={week.key} className="space-y-4">
              <div className="flex items-baseline justify-between gap-3 border-b pb-2">
                <div className="min-w-0 truncate">
                  <span className="text-sm font-semibold">{week.label}</span>
                  <span className="ml-2 text-[11px] tabular-nums text-muted-foreground">
                    {week.range}
                  </span>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatMinutes(week.minutes)}
                </span>
              </div>
              {week.days.map(([day, rows]) => (
                <div key={day} className="space-y-0.5">
                  <SectionHead
                    label={format(combine(day, "12:00"), "EEE d MMM")}
                  >
                    {rows.length > 1 && (
                      <span className="shrink-0 text-[11px] font-medium tabular-nums">
                        {formatMinutes(
                          rows.reduce((sum, row) => sum + row.workedMinutes, 0),
                        )}
                      </span>
                    )}
                  </SectionHead>
                  <div className="divide-y">
                    {rows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => setEditing({ session: row })}
                        className="flex min-h-12 w-full min-w-0 items-center gap-3 py-2 text-left transition-opacity active:opacity-60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm tabular-nums">
                            {localTime(new Date(row.start))} –{" "}
                            {row.end ? localTime(new Date(row.end)) : "now"}
                          </div>
                          {(multipleJobs ||
                            row.breakMinutes > 0 ||
                            row.note) && (
                            <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                              {[
                                multipleJobs
                                  ? jobName.get(row.jobId)
                                  : undefined,
                                row.breakMinutes > 0
                                  ? `break ${formatMinutes(row.breakMinutes)}`
                                  : undefined,
                                row.note,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          )}
                        </div>
                        <span
                          className={cn(
                            "shrink-0 text-sm font-medium tabular-nums",
                            !row.end && "text-status-good",
                          )}
                        >
                          {formatMinutes(row.workedMinutes)}
                        </span>
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
          <Button
            variant="ghost"
            className="h-11 w-full text-muted-foreground"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              setWeeks((value) => value + HISTORY_WEEKS);
            }}
          >
            {loadingMore && <Loader2 className="size-4 animate-spin" />}
            {HISTORY_WEEKS} more weeks
          </Button>
        </div>
      )}

      {editing && (
        <SessionSheet
          key={editing.session?.id ?? "new"}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          session={editing.session}
          jobs={jobs}
          onSaved={async () => {
            await Promise.all([load(), onChanged()]);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pay
// ---------------------------------------------------------------------------

function PayTab({
  overview,
  revision,
}: {
  overview: WorkHoursOverview;
  revision: number;
}) {
  const { routes } = useAdmin();
  if (overview.payPeriods.length === 0) {
    return (
      <div className="flex justify-center pt-10">
        <Button asChild variant="outline" className="h-11">
          <Link href={routes.finance.payoutNew}>
            <Plus className="size-4" />
            Payout
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-10">
      {overview.payPeriods.map((period) => (
        <div key={period.ruleId} className="space-y-4">
          <PayPeriodSummary period={period} />
          {period.lines.length > 0 && (
            <div className="space-y-1 text-xs tabular-nums">
              {period.lines.map((line) => (
                <div key={line.lineId} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {line.name}
                  </span>
                  <span className="shrink-0">
                    −{money(line.amountMinor, period.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1">
            <SectionHead label="Payouts" />
            <FinancePayoutSchedule
              ruleId={period.ruleId}
              refreshKey={revision}
              limit={12}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function HoursSkeleton() {
  return (
    <div className="flex flex-col items-center gap-5 pt-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-14 w-48" />
      <Skeleton className="size-40 rounded-full" />
      <Skeleton className="h-11 w-full max-w-72" />
      <div className="grid w-full grid-cols-3 gap-4 pt-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </div>
  );
}

/**
 * The hour tracker. `standalone` is the home-screen app: full-bleed, safe-area
 * aware, with a bottom tab bar. Otherwise it sits in a dashboard under the
 * standard header with line tabs.
 */
export function HoursApp({ standalone = false }: { standalone?: boolean }) {
  const { client, slots } = useAdmin();
  const [tab, setTab] = useState<HoursTab>("clock");
  const [overview, setOverview] = useState<WorkHoursOverview | null>(null);
  const [revision, setRevision] = useState(0);
  const [jobsOpen, setJobsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverview(await fetchWorkHours(client));
      setRevision((value) => value + 1);
    } catch (error) {
      toast.error(errorMessage(error, "Hours unavailable"));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // Home-screen shortcuts open a tab by query parameter.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((row) => row.value === requested)) {
      setTab(requested as HoursTab);
    }
  }, []);

  // A home-screen app is resumed, not reopened: refresh whenever it returns.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  function selectTab(next: HoursTab) {
    setTab(next);
    if (standalone) window.scrollTo({ top: 0 });
  }

  const content: ReactNode = !overview ? (
    <HoursSkeleton />
  ) : tab === "clock" ? (
    <ClockTab
      overview={overview}
      onChanged={load}
      onEditJobs={() => setJobsOpen(true)}
    />
  ) : tab === "history" ? (
    <HistoryTab jobs={overview.jobs} revision={revision} onChanged={load} />
  ) : (
    <PayTab overview={overview} revision={revision} />
  );

  const settings = (
    <Button
      size="icon"
      variant="ghost"
      aria-label="Jobs"
      onClick={() => setJobsOpen(true)}
      disabled={!overview}
    >
      <Settings2 className="size-4" />
    </Button>
  );

  const jobsSheet = overview && jobsOpen && (
    <JobsSheet
      open
      onOpenChange={setJobsOpen}
      jobs={overview.jobs}
      onSaved={load}
    />
  );

  if (standalone) {
    return (
      <div className="flex min-h-dvh flex-col overflow-x-clip bg-background">
        <header className="sticky top-0 z-30 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex h-12 max-w-md items-center gap-2 pr-2 pl-4">
            <span className="flex-1 text-sm font-semibold">
              {TABS.find((row) => row.value === tab)?.label}
            </span>
            {settings}
          </div>
        </header>
        <main className="mx-auto w-full max-w-md flex-1 px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
          {content}
        </main>
        <BottomTabBar>
          <div className="mx-auto grid max-w-md grid-cols-3">
            {TABS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-current={tab === value ? "page" : undefined}
                onClick={() => selectTab(value)}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 [-webkit-tap-highlight-color:transparent]",
                  tab === value ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon
                  className={cn("size-5", tab === value && "stroke-[2.5]")}
                />
                <span className="text-[11px] font-medium">{label}</span>
              </button>
            ))}
          </div>
        </BottomTabBar>
        {jobsSheet}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Clock className="size-4 text-muted-foreground" />}
        title="Hours"
      >
        {settings}
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-5">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as HoursTab)}
          >
            <TabsList variant="line" className="w-full justify-start">
              {TABS.map(({ value, label }) => (
                <TabsTrigger key={value} value={value}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {content}
        </div>
      </div>
      {jobsSheet}
    </div>
  );
}
