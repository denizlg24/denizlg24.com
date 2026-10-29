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
import { EmptyState } from "@repo/ui/empty-state";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListGroupLabel, ListRow } from "@repo/ui/list";
import { NumericField } from "@repo/ui/numeric-field";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Properties, Property } from "@repo/ui/properties";
import { Section, SectionLabel } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { Stat, StatGroup } from "@repo/ui/stat";
import { StatusDot } from "@repo/ui/status-dot";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  formatMinutes,
  majorToMinor,
  minorToMajor,
  sessionMinutes,
} from "@repo/utils";
import {
  endOfISOWeek,
  format,
  getISOWeek,
  startOfISOWeek,
  startOfMonth,
} from "date-fns";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Clock,
  Coffee,
  History,
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

const TABS = [
  { value: "clock", label: "Clock", icon: Clock },
  { value: "history", label: "History", icon: History },
  { value: "pay", label: "Pay", icon: Wallet },
] as const;

type HoursTab = (typeof TABS)[number]["value"];

function isHoursTab(value: string | null): value is HoursTab {
  return TABS.some((row) => row.value === value);
}

const HISTORY_WEEKS = 8;

const ACTION_LABEL = {
  in: "Check in",
  out: "Check out",
  break: "Break",
  resume: "Resume",
} as const;

type ClockAction = keyof typeof ACTION_LABEL;

/** Touch-sized on a phone, the house control height from `md` up. */
const TOUCH = "max-md:h-11 max-md:text-base";

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

/** A pill in a row of mutually exclusive choices, sized for a thumb. */
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
        "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] whitespace-nowrap tabular-nums transition-colors active:opacity-70 md:h-7 md:px-2.5",
        selected
          ? "bg-surface font-medium text-accent-strong dark:bg-muted"
          : "text-muted-foreground hover:bg-surface/60 hover:text-accent-strong",
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
  const ready = Boolean(name.trim()) && rate !== "";
  const idPrefix = job?.id ?? "new";

  async function save() {
    if (!ready || saving) return;
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
    <div className="flex flex-col gap-4">
      <FormGrid>
        <FormField
          label="Job"
          htmlFor={`${idPrefix}-name`}
          className="sm:col-span-2"
        >
          <Input
            id={`${idPrefix}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
            placeholder="Pandora"
            className={TOUCH}
          />
        </FormField>
        <FormField label="Hourly rate">
          <NumericField
            value={rate}
            onValueChange={(value) => setRate(value)}
            className={cn("text-right tabular-nums", TOUCH)}
            placeholder="0.00"
          />
        </FormField>
        <FormField label="Currency">
          <CurrencySelect
            value={currency}
            onValueChange={setCurrency}
            className="max-md:h-11"
          />
        </FormField>
        <FormField label="Hours / week">
          <NumericField
            value={weekly}
            onValueChange={(value) => setWeekly(value)}
            className={cn("text-right tabular-nums", TOUCH)}
            placeholder="—"
          />
        </FormField>
        <FormField label="Timezone" htmlFor={`${idPrefix}-timezone`}>
          <Input
            id={`${idPrefix}-timezone`}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={TOUCH}
          />
        </FormField>
      </FormGrid>
      <label
        htmlFor={`${idPrefix}-breaks-paid`}
        className="flex min-h-8 items-center justify-between gap-3 text-sm text-accent-strong max-md:h-11"
      >
        Paid breaks
        <Switch
          id={`${idPrefix}-breaks-paid`}
          checked={breaksPaid}
          onCheckedChange={setBreaksPaid}
        />
      </label>
      <div className="flex justify-end">
        <Button
          type="button"
          className="max-md:h-11 max-md:w-full"
          disabled={saving || !ready}
          onClick={() => void save()}
        >
          {saving ? <Spinner className="size-3.5" /> : null}
          {job ? "Save" : "Add"}
        </Button>
      </div>
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
    <HoursSheet open={open} onOpenChange={onOpenChange} title="Jobs">
      <div className="flex flex-col gap-6">
        {jobs.length > 0 ? (
          <List divided>
            {jobs.map((row) => {
              const expanded = editing === row.id;
              return (
                <div key={row.id} className="flex flex-col">
                  <ListRow
                    aria-expanded={expanded}
                    onClick={() => setEditing(expanded ? null : row.id)}
                    className="max-md:min-h-14"
                    title={
                      <span
                        className={cn(
                          row.status === "archived" && "text-muted-foreground",
                        )}
                      >
                        {row.name}
                      </span>
                    }
                    description={[
                      `${money(row.hourlyRateMinor, row.currency)}/h`,
                      row.expectedWeeklyHours !== undefined
                        ? `${row.expectedWeeklyHours} h/wk`
                        : undefined,
                      row.status === "archived" ? "archived" : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    trailing={
                      <>
                        {/* The switch must not toggle the row it sits in. */}
                        <span
                          className="flex items-center"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
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
                                toast.error(
                                  errorMessage(error, "Update failed"),
                                );
                              }
                            }}
                          />
                        </span>
                        <ChevronRight
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                      </>
                    }
                  />
                  {expanded ? (
                    <div className="pt-2 pb-5">
                      <JobForm
                        job={row}
                        onSaved={async () => {
                          await onSaved();
                          toast.success("Saved");
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </List>
        ) : null}

        {editing === "new" ? (
          <Section title="New job">
            <JobForm
              job={null}
              onSaved={async () => {
                await onSaved();
                setEditing(null);
                toast.success("Added");
              }}
            />
          </Section>
        ) : (
          <div>
            <Button
              type="button"
              variant="outline"
              className="max-md:h-11 max-md:w-full"
              onClick={() => setEditing("new")}
            >
              <Plus />
              Job
            </Button>
          </div>
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
      className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {older ? (
        <Chip selected onClick={() => setCalendarOpen(true)}>
          {format(combine(value, "12:00"), "EEE d MMM")}
        </Chip>
      ) : null}
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
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Pick a day"
            className="shrink-0 text-muted-foreground max-md:size-9"
          >
            <CalendarDays />
          </Button>
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
      footerStart={
        session ? (
          <ConfirmButton
            title="Delete shift?"
            actionLabel="Delete"
            destructive
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
                type="button"
                variant="ghost"
                className="text-destructive max-md:h-11"
              >
                <Trash2 />
                Delete
              </Button>
            }
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex items-end justify-between gap-3">
          <div className="font-calistoga text-4xl leading-none tabular-nums text-accent-strong">
            {preview ? formatMinutes(preview.workedMinutes) : "—"}
            <span className="ml-1 font-sans text-base text-muted-foreground">
              h
            </span>
          </div>
          <div className="min-w-0 text-right text-xs tabular-nums text-muted-foreground">
            {preview && job ? (
              <div className="font-medium text-accent-strong">
                {money(
                  Math.round(
                    (preview.workedMinutes * job.hourlyRateMinor) / 60,
                  ),
                  job.currency,
                )}
              </div>
            ) : null}
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

        {activeJobs.length > 1 ? (
          <FormField label="Job">
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger className="w-full max-md:h-11!">
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
          </FormField>
        ) : null}

        <Section title="Day">
          <DayStrip value={day} onValueChange={setDay} />
        </Section>

        <Section title="Time">
          <FormGrid>
            <FormField label="Start">
              <TimeField
                value={startTime}
                onValueChange={setStartTime}
                aria-label="Start"
              />
            </FormField>
            <FormField label="End">
              <TimeField
                value={endTime}
                onValueChange={setEndTime}
                fallback={startTime}
                placeholder="Open"
                clearable={Boolean(session)}
                aria-label="End"
              />
            </FormField>
          </FormGrid>
        </Section>

        <Section
          title="Breaks"
          count={breaks.length || undefined}
          actions={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="max-md:h-9"
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
              <Plus />
              Break
            </Button>
          }
        >
          {breaks.map((item, index) => (
            <div key={item.key} className="flex flex-col gap-1.5">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove break ${index + 1}`}
                  onClick={() =>
                    setBreaks((current) =>
                      current.filter((row) => row.key !== item.key),
                    )
                  }
                  className="text-muted-foreground max-md:size-9"
                >
                  <Trash2 />
                </Button>
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
        </Section>

        <FormField label="Note" htmlFor="shift-note">
          <Textarea
            id="shift-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="max-md:min-h-11 max-md:text-base"
          />
        </FormField>
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
  /** Resolves true when the server took it; the sheet stays open otherwise. */
  onConfirm: (action: ClockAction, at: Date) => Promise<boolean>;
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

  async function confirm() {
    if (!at || pending) return;
    if (await onConfirm(action, at)) onOpenChange(false);
  }

  return (
    <HoursSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Earlier"
      compact
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="max-md:hidden"
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="max-md:h-12 max-md:w-full max-md:text-base"
            disabled={pending || !at}
            onClick={() => void confirm()}
          >
            {pending ? <Spinner className="size-3.5" /> : null}
            {ACTION_LABEL[action]} at {time}
            {at && localDay(at) !== localDay(new Date()) && " yesterday"}
          </Button>
        </div>
      }
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        {actions.length > 1 ? (
          <FilterTabs
            value={action}
            onChange={setAction}
            options={actions.map((value) => ({
              value,
              label: ACTION_LABEL[value],
            }))}
            className="justify-center"
          />
        ) : null}
        <TimeField
          value={time}
          onValueChange={setTime}
          step={5}
          size="lg"
          aria-label="Time"
        />
        <div className="grid grid-cols-4 gap-1">
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

function PayPeriodSummary({ period }: { period: WorkPayPeriod }) {
  const { routes } = useAdmin();
  return (
    <Section
      title={period.ruleName}
      actions={
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
        >
          <Link
            href={routes.finance.rule(period.ruleId)}
            aria-label="Open in Finance"
          >
            <ArrowUpRight />
          </Link>
        </Button>
      }
    >
      <StatGroup className="grid-cols-3">
        <Stat
          label="Net"
          tone="good"
          value={money(period.netMinor, period.currency)}
          hint={`pays ${shortDay(period.payoutDate)}`}
        />
        <Stat
          label="Gross"
          value={money(period.grossMinor, period.currency)}
          hint={`${shortDay(period.periodStart)} – ${shortDay(period.periodEnd)}${period.partial ? " · partial" : ""}`}
        />
        <Stat
          label="Hours"
          value={formatMinutes(period.loggedMinutes)}
          hint={
            period.projectedMinutes !== period.loggedMinutes
              ? `→ ${formatMinutes(period.projectedMinutes)}`
              : undefined
          }
        />
      </StatGroup>
    </Section>
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

  // The server counts a shift on the day it starts, so the running shift's
  // live minutes only belong to the totals whose range holds that day — an
  // overnight shift begun yesterday is in the week, not in today.
  const liveDelta = active
    ? Math.floor(runningMs / 60_000) - active.workedMinutes
    : 0;
  const inRange = (from: string) => Boolean(active && active.day >= from);
  const todayMinutes =
    overview.today.workedMinutes + (inRange(localDay(now)) ? liveDelta : 0);
  const weekMinutes =
    overview.week.workedMinutes +
    (inRange(localDay(startOfISOWeek(now))) ? liveDelta : 0);
  const monthMinutes =
    overview.month.workedMinutes +
    (inRange(localDay(startOfMonth(now))) ? liveDelta : 0);

  async function act(action: ClockAction, at?: Date) {
    if (pending) return false;
    setPending(action);
    try {
      await clockWork(client, {
        action,
        jobId: action === "in" ? jobId : undefined,
        at: at?.toISOString(),
      });
      await onChanged();
      return true;
    } catch (error) {
      toast.error(errorMessage(error, "Failed"));
      return false;
    } finally {
      setPending(null);
    }
  }

  if (activeJobs.length === 0 && !active) {
    return (
      <Section title="Job">
        <JobForm job={null} onSaved={onChanged} />
      </Section>
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
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-5 pt-2">
        <div className="flex max-w-full items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <StatusDot
            tone={!active ? "muted" : openBreak ? "warning" : "good"}
            className="size-1.5"
          />
          <span className="truncate">
            {status}
            {job && activeJobs.length > 1 && ` · ${job.name}`}
          </span>
        </div>

        <div className="text-center">
          <div
            className={cn(
              "font-calistoga text-6xl leading-none tabular-nums",
              openBreak ? "text-muted-foreground" : "text-accent-strong",
            )}
          >
            {active ? clockface(runningMs) : formatMinutes(todayMinutes)}
          </div>
          <div className="mt-2 text-xs tabular-nums text-muted-foreground">
            {active ? `today ${formatMinutes(todayMinutes)}` : "today"}
          </div>
        </div>

        {!active && activeJobs.length > 1 ? (
          <Select value={jobId ?? activeJobs[0]?.id} onValueChange={setJobId}>
            <SelectTrigger className="w-full max-w-64 max-md:h-10!">
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
        ) : null}

        {/* The clock's one bespoke control: a thumb-sized round button. */}
        <button
          type="button"
          disabled={Boolean(pending)}
          onClick={() => void act(primary)}
          className={cn(
            "flex size-40 select-none items-center justify-center rounded-full text-2xl font-semibold tracking-tight transition-[transform,opacity] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-95 disabled:opacity-60 [-webkit-tap-highlight-color:transparent]",
            primary === "in"
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "border-2 border-accent-strong bg-background text-accent-strong hover:bg-surface/70",
          )}
        >
          {pending === primary ? (
            <Spinner className="size-7" />
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
          {active ? (
            <Button
              variant="outline"
              disabled={Boolean(pending)}
              onClick={() => void act(openBreak ? "resume" : "break")}
              className="max-md:h-11"
            >
              {pending === "break" || pending === "resume" ? (
                <Spinner className="size-3.5" />
              ) : (
                <Coffee />
              )}
              {openBreak ? "Resume" : "Break"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            disabled={Boolean(pending)}
            onClick={() => setEarlierOpen(true)}
            className="text-muted-foreground max-md:h-11"
          >
            <Clock />
            Earlier
          </Button>
        </div>
      </div>

      <StatGroup className="grid-cols-3">
        <Stat label="Today" value={formatMinutes(todayMinutes)} />
        <Stat label="Week" value={formatMinutes(weekMinutes)} />
        <Stat label="Month" value={formatMinutes(monthMinutes)} />
      </StatGroup>

      {overview.payPeriods.map((period) => (
        <PayPeriodSummary key={period.ruleId} period={period} />
      ))}

      {activeJobs.length > 0 && overview.payPeriods.length === 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onEditJobs}
          className="mx-auto max-w-full text-muted-foreground tabular-nums"
        >
          <span className="truncate">
            {activeJobs
              .map(
                (row) =>
                  `${row.name} · ${money(row.hourlyRateMinor, row.currency)}/h`,
              )
              .join(" · ")}
          </span>
        </Button>
      ) : null}

      {earlierOpen ? (
        <EarlierSheet
          open
          onOpenChange={setEarlierOpen}
          actions={earlierActions}
          initial={active ? (openBreak ? "resume" : "out") : "in"}
          pending={Boolean(pending)}
          onConfirm={(action, at) => act(action, at)}
        />
      ) : null}
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
    <div className="flex flex-col gap-8">
      <SectionLabel
        count={`${formatMinutes(total)} h`}
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="max-md:h-9"
            onClick={() => setEditing({ session: null })}
          >
            <Plus />
            Shift
          </Button>
        }
      >
        {weeks} weeks
      </SectionLabel>

      {sessions === null ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-9 w-full" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState icon={<History />} label="No shifts" compact />
      ) : (
        <>
          {grouped.map((week) => (
            <Section
              key={week.key}
              title={
                <>
                  {week.label}
                  <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
                    {week.range}
                  </span>
                </>
              }
              actions={
                <span className="text-sm font-medium tabular-nums text-accent-strong">
                  {formatMinutes(week.minutes)}
                </span>
              }
            >
              <div className="flex flex-col">
                {week.days.map(([day, rows]) => (
                  <div key={day} className="flex flex-col">
                    <ListGroupLabel className="flex items-center justify-between gap-3">
                      <span>{format(combine(day, "12:00"), "EEE d MMM")}</span>
                      {rows.length > 1 ? (
                        <span className="tabular-nums normal-case tracking-normal">
                          {formatMinutes(
                            rows.reduce(
                              (sum, row) => sum + row.workedMinutes,
                              0,
                            ),
                          )}
                        </span>
                      ) : null}
                    </ListGroupLabel>
                    <List>
                      {rows.map((row) => {
                        const description = [
                          multipleJobs ? jobName.get(row.jobId) : undefined,
                          row.breakMinutes > 0
                            ? `break ${formatMinutes(row.breakMinutes)}`
                            : undefined,
                          row.note,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <ListRow
                            key={row.id}
                            onClick={() => setEditing({ session: row })}
                            className="max-md:min-h-12"
                            title={
                              <span className="tabular-nums">
                                {localTime(new Date(row.start))} –{" "}
                                {row.end ? localTime(new Date(row.end)) : "now"}
                              </span>
                            }
                            description={description || undefined}
                            meta={
                              <span
                                className={cn(
                                  "text-sm font-medium",
                                  row.end
                                    ? "text-accent-strong"
                                    : "text-status-good",
                                )}
                              >
                                {formatMinutes(row.workedMinutes)}
                              </span>
                            }
                          />
                        );
                      })}
                    </List>
                  </div>
                ))}
              </div>
            </Section>
          ))}
          <Button
            variant="ghost"
            className="w-full text-muted-foreground max-md:h-11"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              setWeeks((value) => value + HISTORY_WEEKS);
            }}
          >
            {loadingMore ? <Spinner className="size-3.5" /> : null}
            {HISTORY_WEEKS} more weeks
          </Button>
        </>
      )}

      {editing ? (
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
      ) : null}
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
      <EmptyState
        icon={<Wallet />}
        label="No payouts"
        action={
          <Button asChild variant="outline" className="max-md:h-11">
            <Link href={routes.finance.payoutNew}>
              <Plus />
              Payout
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-10">
      {overview.payPeriods.map((period) => (
        <div key={period.ruleId} className="flex flex-col gap-6">
          <PayPeriodSummary period={period} />
          {period.lines.length > 0 ? (
            <Section title="Deductions" count={period.lines.length}>
              <Properties>
                {period.lines.map((line) => (
                  <Property key={line.lineId} label={line.name}>
                    <span className="block text-right tabular-nums">
                      −{money(line.amountMinor, period.currency)}
                    </span>
                  </Property>
                ))}
              </Properties>
            </Section>
          ) : null}
          <Section title="Payouts">
            <FinancePayoutSchedule
              ruleId={period.ruleId}
              refreshKey={revision}
              limit={12}
            />
          </Section>
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
    <div className="flex flex-col items-center gap-5 pt-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-14 w-48" />
      <Skeleton className="size-40 rounded-full" />
      <Skeleton className="h-8 w-full max-w-72" />
      <div className="grid w-full grid-cols-3 gap-8 pt-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </div>
  );
}

/**
 * The hour tracker. `standalone` is the home-screen app: full-bleed, safe-area
 * aware, with a bottom tab bar. Otherwise it is an ordinary dashboard page
 * with the tabs in its toolbar.
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
    if (isHoursTab(requested)) setTab(requested);
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
      size="icon-sm"
      variant="ghost"
      aria-label="Jobs"
      onClick={() => setJobsOpen(true)}
      disabled={!overview}
      className="max-md:size-9"
    >
      <Settings2 />
    </Button>
  );

  const jobsSheet =
    overview && jobsOpen ? (
      <JobsSheet
        open
        onOpenChange={setJobsOpen}
        jobs={overview.jobs}
        onSaved={load}
      />
    ) : null;

  if (standalone) {
    return (
      <div className="flex min-h-dvh flex-col overflow-x-clip bg-background">
        <header className="sticky top-0 z-30 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex h-12 max-w-md items-center gap-2 pr-2 pl-4">
            <h1 className="flex-1 text-sm font-semibold text-accent-strong">
              {TABS.find((row) => row.value === tab)?.label}
            </h1>
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
                  tab === value
                    ? "text-accent-strong"
                    : "text-muted-foreground",
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
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Clock />}
        title="Hours"
      >
        {settings}
      </PageHeader>
      <PageToolbar>
        <FilterTabs
          value={tab}
          onChange={selectTab}
          options={TABS.map(({ value, label }) => ({ value, label }))}
        />
      </PageToolbar>
      <PageBody width="narrow">{content}</PageBody>
      {jobsSheet}
    </Page>
  );
}
