"use client";

import type {
  WorkHoursOverview,
  WorkJob,
  WorkPayPeriod,
  WorkSession,
} from "@repo/schemas";
import { BottomTabBar } from "@repo/ui/bottom-tab-bar";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CurrencySelect } from "@repo/ui/currency-select";
import { DatePicker } from "@repo/ui/date-picker";
import { Input } from "@repo/ui/input";
import { NumericField } from "@repo/ui/numeric-field";
import { PageHeader } from "@repo/ui/page-header";
import { ResponsiveDialog } from "@repo/ui/responsive-dialog";
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
import { format } from "date-fns";
import {
  ArrowUpRight,
  Clock,
  Coffee,
  History,
  Loader2,
  Plus,
  Settings2,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
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

// ---------------------------------------------------------------------------
// Job form
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
      <FieldRow label="Job" htmlFor="job-name">
        <Input
          id="job-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Pandora"
        />
      </FieldRow>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <FieldRow label="Hourly rate" className="min-w-0">
          <NumericField
            value={rate}
            onValueChange={(value) => setRate(value)}
            className="text-right tabular-nums"
            placeholder="0.00"
          />
        </FieldRow>
        <FieldRow label="Currency" className="min-w-0">
          <CurrencySelect value={currency} onValueChange={setCurrency} />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Hours / week">
          <NumericField
            value={weekly}
            onValueChange={(value) => setWeekly(value)}
            className="text-right tabular-nums"
            placeholder="—"
          />
        </FieldRow>
        <FieldRow label="Timezone">
          <Input
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </FieldRow>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <label htmlFor="job-breaks-paid">Paid breaks</label>
        <Switch
          id="job-breaks-paid"
          checked={breaksPaid}
          onCheckedChange={setBreaksPaid}
        />
      </div>
      <Button
        className="w-full"
        disabled={saving || !ready}
        onClick={() => void save()}
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        {job ? "Save job" : "Add job"}
      </Button>
    </div>
  );
}

function JobsDialog({
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
  const job = jobs.find((row) => row.id === editing) ?? null;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jobs"
      className="max-w-md"
    >
      <div className="space-y-5">
        {jobs.length > 1 || editing === null ? (
          <div className="divide-y">
            {jobs.map((row) => (
              <div key={row.id} className="flex items-center gap-3 py-2.5">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setEditing(row.id)}
                >
                  <div
                    className={cn(
                      "truncate text-sm",
                      row.status === "archived" && "text-muted-foreground",
                    )}
                  >
                    {row.name}
                  </div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {money(row.hourlyRateMinor, row.currency)}/h
                  </div>
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
            ))}
          </div>
        ) : null}
        {editing !== null ? (
          <JobForm
            key={editing}
            job={job}
            onSaved={async () => {
              await onSaved();
              toast.success("Saved");
            }}
          />
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setEditing("new")}
          >
            <Plus className="size-3.5" />
            Job
          </Button>
        )}
      </div>
    </ResponsiveDialog>
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

function SessionDialog({
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
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={session ? shortDay(session.day) : "Shift"}
      className="max-w-md"
    >
      <div className="space-y-4">
        {activeJobs.length > 1 && (
          <FieldRow label="Job">
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger className="w-full">
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
        <FieldRow label="Day">
          <DatePicker
            value={day}
            onValueChange={(value) => value && setDay(value)}
            aria-label="Day"
          />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Start" htmlFor="shift-start">
            <Input
              id="shift-start"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className="tabular-nums"
            />
          </FieldRow>
          <FieldRow label="End" htmlFor="shift-end">
            <Input
              id="shift-end"
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className="tabular-nums"
            />
          </FieldRow>
        </div>

        <div className="space-y-2">
          <SectionHead label="Breaks">
            <Button
              size="xs"
              variant="ghost"
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
              <Plus className="size-3" />
              Break
            </Button>
          </SectionHead>
          {breaks.map((item) => (
            <div
              key={item.key}
              className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
            >
              <Input
                type="time"
                value={item.start}
                aria-label="Break start"
                onChange={(event) =>
                  setBreaks((current) =>
                    current.map((row) =>
                      row.key === item.key
                        ? { ...row, start: event.target.value }
                        : row,
                    ),
                  )
                }
                className="h-9 tabular-nums"
              />
              <Input
                type="time"
                value={item.end}
                aria-label="Break end"
                onChange={(event) =>
                  setBreaks((current) =>
                    current.map((row) =>
                      row.key === item.key
                        ? { ...row, end: event.target.value }
                        : row,
                    ),
                  )
                }
                className="h-9 tabular-nums"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove break"
                onClick={() =>
                  setBreaks((current) =>
                    current.filter((row) => row.key !== item.key),
                  )
                }
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <FieldRow label="Note" htmlFor="shift-note">
          <Textarea
            id="shift-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
          />
        </FieldRow>

        {preview && (
          <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>
              {breaks.length > 0 &&
                `break ${formatMinutes(preview.breakMinutes)}`}
            </span>
            <span className="font-medium text-foreground">
              {formatMinutes(preview.workedMinutes)} h
              {job &&
                ` · ${money(Math.round((preview.workedMinutes * job.hourlyRateMinor) / 60), job.currency)}`}
            </span>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={saving || !jobId || !startTime}
            onClick={() => void save()}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {session ? "Save" : "Add shift"}
          </Button>
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
              trigger={<Button variant="outline">Delete</Button>}
            />
          )}
        </div>
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

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
      <SectionHead
        label={`${period.ruleName} · ${shortDay(period.payoutDate)}`}
      >
        <Link
          href={routes.finance.rule(period.ruleId)}
          aria-label="Open in Finance"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" />
        </Link>
      </SectionHead>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[26px] font-semibold leading-none tabular-nums tracking-tight text-status-good">
            {money(period.netMinor, period.currency)}
          </div>
          <div className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
            gross {money(period.grossMinor, period.currency)}
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
  const [backdate, setBackdate] = useState<{
    action: "in" | "out" | "break" | "resume";
  } | null>(null);
  const [backdateTime, setBackdateTime] = useState(localTime(new Date()));

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

  async function act(action: "in" | "out" | "break" | "resume", at?: Date) {
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
      <div className="mx-auto max-w-sm space-y-4 pt-6">
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

  return (
    <div className="space-y-10">
      <div className="flex flex-col items-center gap-6 pt-6">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              !active
                ? "bg-muted-foreground/40"
                : openBreak
                  ? "bg-status-warning"
                  : "bg-status-good",
            )}
          />
          {status}
          {job && activeJobs.length > 1 && ` · ${job.name}`}
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
            <SelectTrigger size="sm" className="w-48">
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
            "flex size-44 select-none items-center justify-center rounded-full text-2xl font-semibold tracking-tight transition-all active:scale-95 disabled:opacity-60",
            primary === "in"
              ? "bg-foreground text-background shadow-lg"
              : "border-2 border-foreground bg-background text-foreground",
          )}
        >
          {pending === primary ? (
            <Loader2 className="size-7 animate-spin" />
          ) : primary === "in" ? (
            "Check in"
          ) : (
            "Check out"
          )}
        </button>

        <div className="flex h-10 items-center gap-2">
          {active && (
            <Button
              variant="outline"
              size="lg"
              disabled={Boolean(pending)}
              onClick={() => void act(openBreak ? "resume" : "break")}
              className="min-w-36"
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
            size="lg"
            disabled={Boolean(pending)}
            onClick={() => {
              setBackdateTime(localTime(new Date()));
              setBackdate({
                action: active ? (openBreak ? "resume" : "out") : "in",
              });
            }}
            className="text-muted-foreground"
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

      <ResponsiveDialog
        open={backdate !== null}
        onOpenChange={(open) => {
          if (!open) setBackdate(null);
        }}
        title="Earlier"
        className="max-w-sm"
      >
        {backdate && (
          <div className="space-y-4">
            <div className="flex gap-1">
              {(active
                ? openBreak
                  ? (["resume", "out"] as const)
                  : (["break", "out"] as const)
                : (["in"] as const)
              ).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={backdate.action === value ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setBackdate({ action: value })}
                >
                  {ACTION_LABEL[value]}
                </Button>
              ))}
            </div>
            <Input
              type="time"
              value={backdateTime}
              onChange={(event) => setBackdateTime(event.target.value)}
              className="h-12 text-center text-2xl tabular-nums"
              aria-label="Time"
            />
            <Button
              className="w-full"
              disabled={Boolean(pending) || !backdateTime}
              onClick={async () => {
                const at = combine(localDay(new Date()), backdateTime);
                // A time later than now meant yesterday evening.
                if (at > new Date()) at.setDate(at.getDate() - 1);
                await act(backdate.action, at);
                setBackdate(null);
              }}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {ACTION_LABEL[backdate.action]} · {backdateTime}
            </Button>
          </div>
        )}
      </ResponsiveDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

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
    }
  }, [client, weeks]);

  useEffect(() => {
    void revision;
    void load();
  }, [load, revision]);

  const byDay = useMemo(() => {
    const groups = new Map<string, WorkSession[]>();
    for (const session of sessions ?? []) {
      const list = groups.get(session.day) ?? [];
      list.push(session);
      groups.set(session.day, list);
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [sessions]);

  const total = (sessions ?? []).reduce(
    (sum, row) => sum + row.workedMinutes,
    0,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] tabular-nums text-muted-foreground">
          {weeks} weeks · {formatMinutes(total)} h
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing({ session: null })}
        >
          <Plus className="size-3.5" />
          Shift
        </Button>
      </div>

      {sessions === null ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-12 w-full" />
          ))}
        </div>
      ) : byDay.length === 0 ? (
        <Empty label="No shifts" />
      ) : (
        <div className="space-y-5">
          {byDay.map(([day, rows]) => (
            <div key={day} className="space-y-1">
              <SectionHead label={format(combine(day, "12:00"), "EEE d MMM")}>
                <span className="text-[11px] font-medium tabular-nums">
                  {formatMinutes(
                    rows.reduce((sum, row) => sum + row.workedMinutes, 0),
                  )}
                </span>
              </SectionHead>
              <div className="divide-y">
                {rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setEditing({ session: row })}
                    className="flex w-full min-w-0 items-center gap-3 py-2.5 text-left transition-opacity active:opacity-60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm tabular-nums">
                        {localTime(new Date(row.start))} –{" "}
                        {row.end ? localTime(new Date(row.end)) : "now"}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                        {[
                          multipleJobs ? jobName.get(row.jobId) : undefined,
                          row.breakMinutes > 0
                            ? `break ${formatMinutes(row.breakMinutes)}`
                            : undefined,
                          row.note,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-sm font-medium tabular-nums",
                        !row.end && "text-status-good",
                      )}
                    >
                      {formatMinutes(row.workedMinutes)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => setWeeks((value) => value + HISTORY_WEEKS)}
          >
            Earlier
          </Button>
        </div>
      )}

      {editing && (
        <SessionDialog
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
        <Button asChild variant="outline">
          <Link href={routes.finance.payoutNew}>
            <Plus className="size-3.5" />
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
            <div className="space-y-0.5 text-xs tabular-nums">
              {period.lines.map((line) => (
                <div key={line.lineId} className="flex justify-between">
                  <span className="text-muted-foreground">{line.name}</span>
                  <span>−{money(line.amountMinor, period.currency)}</span>
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
    <div className="flex flex-col items-center gap-6 pt-12">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-14 w-48" />
      <Skeleton className="size-44 rounded-full" />
      <div className="grid w-full grid-cols-3 gap-4 pt-6">
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
    >
      <Settings2 className="size-4" />
    </Button>
  );

  const jobsDialog = overview && jobsOpen && (
    <JobsDialog
      open
      onOpenChange={setJobsOpen}
      jobs={overview.jobs}
      onSaved={load}
    />
  );

  if (standalone) {
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="sticky top-0 z-30 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex h-12 items-center gap-2 px-4">
            <Clock className="size-4 text-muted-foreground" />
            <span className="flex-1 text-sm font-semibold">Hours</span>
            {settings}
          </div>
        </header>
        <main className="mx-auto w-full max-w-md flex-1 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
          {content}
        </main>
        <BottomTabBar>
          <div className="mx-auto grid max-w-md grid-cols-3">
            {TABS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5",
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
        {jobsDialog}
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
      {jobsDialog}
    </div>
  );
}
