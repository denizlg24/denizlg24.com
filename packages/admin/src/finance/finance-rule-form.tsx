"use client";

import type {
  FinanceAccount,
  FinanceCadence,
  FinanceDeductionProfile,
  FinancePayoutConfig,
  FinanceRecurrence,
  FinanceRecurringCandidate,
  FinanceRecurringRule,
  WorkJob,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { CurrencySelect } from "@repo/ui/currency-select";
import { DatePicker } from "@repo/ui/date-picker";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Toggle } from "@repo/ui/toggle";
import { cn } from "@repo/ui/utils";
import {
  computePayout,
  describeRecurrence,
  majorToMinor,
  minorToMajor,
  nextRecurringOccurrences,
  payoutPeriodBounds,
} from "@repo/utils";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { createFinanceRule, updateFinanceRule } from "./finance-data";
import { FieldRow } from "./finance-primitives";
import { money, shortDay, todayKey } from "./finance-series";

const CADENCE_LABEL: Record<FinanceCadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  semiMonthly: "Semi-monthly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const INTERVAL_UNIT: Record<FinanceCadence, string> = {
  daily: "days",
  weekly: "weeks",
  semiMonthly: "months",
  monthly: "months",
  yearly: "years",
};

interface RuleDraft {
  name: string;
  amount: string;
  currency: string;
  /** Set once the currency is chosen by hand, so changing account stops overriding it. */
  currencyPinned: boolean;
  direction: "expense" | "income";
  amountKind: "fixed" | "variable";
  accountId: string;
  cadence: FinanceCadence;
  interval: string;
  weekday: number;
  dayOfMonth: number;
  secondDayOfMonth: number;
  month: number;
  anchorDate: string;
  endDate: string | undefined;
  tolerancePercent: string;
  matchWindowDays: string;
  isPayout: boolean;
  payoutSource: FinancePayoutConfig["source"]["kind"];
  jobId: string;
  cycleCloseDay: number;
  employmentStart: string;
  deductionProfileId: string;
}

const NO_PROFILE = "none";

function draftFromRule(rule: FinanceRecurringRule): RuleDraft {
  const recurrence = rule.recurrence;
  const anchor = new Date(`${rule.anchorDate}T00:00:00Z`);
  return {
    name: rule.name,
    amount: String(minorToMajor(rule.amountMinor, rule.currency)),
    currency: rule.currency,
    // An existing rule's currency is a deliberate choice already.
    currencyPinned: true,
    direction: rule.direction,
    amountKind: rule.amountKind,
    accountId: rule.accountId,
    cadence: recurrence.cadence,
    interval: String(
      recurrence.cadence === "semiMonthly" ? 1 : recurrence.interval,
    ),
    weekday:
      recurrence.cadence === "weekly" ? recurrence.weekday : anchor.getUTCDay(),
    dayOfMonth:
      recurrence.cadence === "monthly" || recurrence.cadence === "yearly"
        ? recurrence.dayOfMonth
        : recurrence.cadence === "semiMonthly"
          ? recurrence.firstDay
          : anchor.getUTCDate(),
    secondDayOfMonth:
      recurrence.cadence === "semiMonthly" ? recurrence.secondDay : 15,
    month: recurrence.cadence === "yearly" ? recurrence.month : 1,
    anchorDate: rule.anchorDate,
    endDate: rule.endDate,
    tolerancePercent: String(rule.matchTolerancePercent),
    matchWindowDays: String(rule.matchWindowDays),
    isPayout: Boolean(rule.payout),
    payoutSource: rule.payout?.source.kind ?? "hours",
    jobId: rule.payout?.source.kind === "hours" ? rule.payout.source.jobId : "",
    cycleCloseDay: rule.payout?.cycleCloseDay ?? 10,
    employmentStart: rule.payout?.employmentStart ?? rule.anchorDate,
    deductionProfileId: rule.payout?.deductionProfileId ?? NO_PROFILE,
    ...(rule.payout?.source.kind === "fixed"
      ? {
          amount: String(
            minorToMajor(rule.payout.source.grossMinor, rule.currency),
          ),
        }
      : {}),
  };
}

function emptyDraft(
  accounts: FinanceAccount[],
  seed: FinanceRecurringCandidate | null,
  payout = false,
  jobs: WorkJob[] = [],
  profiles: FinanceDeductionProfile[] = [],
): RuleDraft {
  const account =
    accounts.find((item) => item.id === seed?.accountId) ?? accounts[0];
  const currency = seed?.currency ?? account?.currency ?? "EUR";
  const today = todayKey();
  const anchor = new Date(`${today}T00:00:00Z`);
  return {
    name: seed?.name ?? "",
    amount: seed ? String(minorToMajor(seed.amountMinor, currency)) : "",
    currency,
    currencyPinned: false,
    direction: seed?.direction ?? "expense",
    amountKind: "fixed",
    accountId: account?.id ?? "",
    cadence: seed?.suggestedCadence ?? "monthly",
    interval: "1",
    weekday: anchor.getUTCDay(),
    dayOfMonth: anchor.getUTCDate(),
    secondDayOfMonth: Math.min(anchor.getUTCDate() + 14, 28),
    month: anchor.getUTCMonth() + 1,
    anchorDate: today,
    endDate: undefined,
    tolerancePercent: "10",
    matchWindowDays: "3",
    ...payoutDefaults(payout, jobs, profiles, today),
  };
}

/** A Danish monthly payroll: hours close on the 10th, paid on the 25th. */
function payoutDefaults(
  payout: boolean,
  jobs: WorkJob[],
  profiles: FinanceDeductionProfile[],
  today: string,
): Pick<
  RuleDraft,
  | "isPayout"
  | "payoutSource"
  | "jobId"
  | "cycleCloseDay"
  | "employmentStart"
  | "deductionProfileId"
> &
  Partial<RuleDraft> {
  const job = jobs.find((item) => item.status === "active") ?? jobs[0];
  const base = {
    isPayout: payout,
    payoutSource: "hours" as const,
    jobId: job?.id ?? "",
    cycleCloseDay: 10,
    employmentStart: today,
    deductionProfileId: profiles[0]?.id ?? NO_PROFILE,
  };
  if (!payout) return base;
  const anchor = new Date(`${today}T00:00:00Z`);
  // The first 25th on or after today; the form's preview shows it.
  const firstPayout =
    anchor.getUTCDate() <= 25
      ? `${today.slice(0, 8)}25`
      : new Date(
          Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 25),
        )
          .toISOString()
          .slice(0, 10);
  return {
    ...base,
    name: job ? `${job.name} salary` : "",
    direction: "income",
    amountKind: "variable",
    currency: job?.currency ?? "DKK",
    currencyPinned: true,
    cadence: "monthly",
    dayOfMonth: 25,
    anchorDate: firstPayout,
    tolerancePercent: "10",
    matchWindowDays: "4",
  };
}

function buildRecurrence(draft: RuleDraft): FinanceRecurrence {
  const interval = Math.max(1, Number(draft.interval) || 1);
  switch (draft.cadence) {
    case "daily":
      return { cadence: "daily", interval };
    case "weekly":
      return { cadence: "weekly", interval, weekday: draft.weekday };
    case "semiMonthly":
      return {
        cadence: "semiMonthly",
        firstDay: draft.dayOfMonth,
        secondDay: draft.secondDayOfMonth,
      };
    case "monthly":
      return { cadence: "monthly", interval, dayOfMonth: draft.dayOfMonth };
    case "yearly":
      return {
        cadence: "yearly",
        interval,
        month: draft.month,
        dayOfMonth: draft.dayOfMonth,
      };
  }
}

export function RuleForm({
  accounts,
  seed,
  rule,
  payout = false,
  jobs = [],
  profiles = [],
  onSaved,
  onDone,
}: {
  accounts: FinanceAccount[];
  seed: FinanceRecurringCandidate | null;
  rule: FinanceRecurringRule | null;
  /** Opens a new rule as a payout. */
  payout?: boolean;
  jobs?: WorkJob[];
  profiles?: FinanceDeductionProfile[];
  onSaved: () => Promise<void>;
  /** Leaves the form — a page navigates away where a sheet just closed. */
  onDone: () => void;
}) {
  const { client } = useAdmin();
  const [draft, setDraft] = useState<RuleDraft>(() =>
    rule
      ? draftFromRule(rule)
      : emptyDraft(accounts, seed, payout, jobs, profiles),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(
      rule
        ? draftFromRule(rule)
        : emptyDraft(accounts, seed, payout, jobs, profiles),
    );
    // `accounts`, `jobs` and `profiles` are intentionally not dependencies:
    // they only seed defaults, and a new array identity mid-edit would
    // discard the draft.
  }, [rule, seed, payout]);

  function patch(next: Partial<RuleDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  const recurrence = useMemo(() => buildRecurrence(draft), [draft]);

  // Same generator the server materializes projections with, so what the
  // preview shows is exactly what will be created.
  const preview = useMemo(
    () =>
      nextRecurringOccurrences(
        {
          anchorDate: draft.anchorDate,
          recurrence,
          endDate: draft.endDate,
        },
        draft.anchorDate,
        3,
      ),
    [draft.anchorDate, draft.endDate, recurrence],
  );

  const selectedJob = jobs.find((job) => job.id === draft.jobId);
  const selectedProfile = profiles.find(
    (profile) => profile.id === draft.deductionProfileId,
  );
  const payoutReady = draft.isPayout
    ? draft.payoutSource === "hours"
      ? Boolean(selectedJob)
      : Boolean(draft.amount)
    : Boolean(draft.amount);
  const ready = Boolean(
    draft.accountId && draft.name.trim() && payoutReady && draft.anchorDate,
  );

  // What the first previewed payout covers and, for a salary, pays.
  const payoutPreview = useMemo(() => {
    if (!draft.isPayout || preview.length === 0) return [];
    const first = nextRecurringOccurrences(
      { anchorDate: draft.anchorDate, recurrence, endDate: draft.endDate },
      draft.anchorDate,
      1,
    )[0];
    return preview.map((date) => ({
      date,
      ...payoutPeriodBounds({
        payoutDate: date,
        cycleCloseDay: draft.cycleCloseDay,
        employmentStart: draft.employmentStart,
        isFirst: date === first,
      }),
    }));
  }, [draft, preview, recurrence]);
  const salaryPreview =
    draft.isPayout && draft.payoutSource === "fixed" && draft.amount
      ? computePayout(
          Math.abs(majorToMinor(Number(draft.amount), draft.currency)),
          selectedProfile?.lines ?? [],
        )
      : null;
  const showsInterval = draft.cadence !== "semiMonthly";
  const showsDayOfMonth =
    draft.cadence === "monthly" ||
    draft.cadence === "yearly" ||
    draft.cadence === "semiMonthly";

  async function save() {
    if (!ready) return;
    setSaving(true);
    try {
      const currency =
        draft.isPayout && draft.payoutSource === "hours" && selectedJob
          ? selectedJob.currency
          : draft.currency;
      const typedMinor = draft.amount
        ? Math.abs(majorToMinor(Number(draft.amount), currency))
        : 0;
      const payoutConfig: FinancePayoutConfig | undefined = draft.isPayout
        ? {
            source:
              draft.payoutSource === "hours"
                ? { kind: "hours", jobId: draft.jobId }
                : { kind: "fixed", grossMinor: typedMinor },
            cycleCloseDay: Math.min(28, Math.max(1, draft.cycleCloseDay)),
            employmentStart: draft.employmentStart,
            deductionProfileId:
              draft.deductionProfileId === NO_PROFILE
                ? undefined
                : draft.deductionProfileId,
            overrides: rule?.payout?.overrides ?? [],
          }
        : undefined;
      const input = {
        accountId: draft.accountId,
        name: draft.name.trim(),
        direction: draft.isPayout ? ("income" as const) : draft.direction,
        amountKind: draft.isPayout ? ("variable" as const) : draft.amountKind,
        // A payout's amount is recomputed server-side on every projection.
        amountMinor: draft.isPayout ? (rule?.amountMinor ?? 0) : typedMinor,
        currency,
        payout: payoutConfig,
        recurrence,
        anchorDate: draft.anchorDate,
        matchTolerancePercent: Math.min(
          100,
          Math.max(0, Number(draft.tolerancePercent) || 0),
        ),
        matchWindowDays: Math.max(0, Number(draft.matchWindowDays) || 0),
        merchantFingerprint:
          rule?.merchantFingerprint ?? seed?.merchantFingerprint,
        status: rule?.status ?? ("active" as const),
        endDate: draft.endDate,
      };
      if (rule) await updateFinanceRule(client, rule.id, input);
      else await createFinanceRule(client, input);
      toast.success(rule ? "Rule updated" : "Rule added");
      onDone();
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rule failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="space-y-5"
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void save();
        }
      }}
    >
      {seed && !rule && (
        <div className="flex items-baseline gap-2 text-[11px] tabular-nums text-muted-foreground">
          <span>every {seed.intervalDays}d</span>
          <span>·</span>
          <span>{Math.round(seed.confidence * 100)}% confidence</span>
        </div>
      )}

      {!rule?.payout && (
        <div className="flex gap-1">
          {(rule
            ? (["expense", "income"] as const)
            : (["expense", "income", "payout"] as const)
          ).map((value) => (
            <Toggle
              key={value}
              size="sm"
              variant="outline"
              pressed={
                value === "payout"
                  ? draft.isPayout
                  : !draft.isPayout && draft.direction === value
              }
              onPressedChange={() =>
                value === "payout"
                  ? setDraft((current) => ({
                      ...current,
                      ...payoutDefaults(true, jobs, profiles, todayKey()),
                      name:
                        current.name ||
                        payoutDefaults(true, jobs, profiles, todayKey()).name ||
                        "",
                    }))
                  : patch({ direction: value, isPayout: false })
              }
              className="flex-1 capitalize"
            >
              {value}
            </Toggle>
          ))}
        </div>
      )}

      <FieldRow label="Name" htmlFor="rule-name">
        <Input
          id="rule-name"
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </FieldRow>

      {draft.isPayout && (
        <div className="space-y-3 border-y py-4">
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Gross from" className="min-w-0">
              <Select
                value={draft.payoutSource}
                onValueChange={(value) =>
                  patch({
                    payoutSource: value as RuleDraft["payoutSource"],
                  })
                }
              >
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="fixed">Fixed salary</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            {draft.payoutSource === "hours" ? (
              <FieldRow label="Job" className="min-w-0">
                <Select
                  value={draft.jobId}
                  onValueChange={(value) => {
                    const job = jobs.find((item) => item.id === value);
                    patch({
                      jobId: value,
                      currency: job?.currency ?? draft.currency,
                    });
                  }}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs.map((job) => (
                      <SelectItem key={job.id} value={job.id}>
                        {job.name} · {money(job.hourlyRateMinor, job.currency)}
                        /h
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
            ) : (
              <FieldRow label="Monthly gross" className="min-w-0">
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={draft.amount}
                  onChange={(event) => patch({ amount: event.target.value })}
                  className="text-right font-medium tabular-nums"
                  placeholder="0.00"
                />
              </FieldRow>
            )}
          </div>
          <FieldRow label="Deductions">
            <Select
              value={draft.deductionProfileId}
              onValueChange={(value) => patch({ deductionProfileId: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROFILE}>None</SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Hours close on" htmlFor="rule-close-day">
              <Input
                id="rule-close-day"
                type="number"
                min={1}
                max={28}
                value={draft.cycleCloseDay}
                onChange={(event) =>
                  patch({ cycleCloseDay: Number(event.target.value) })
                }
                className="tabular-nums"
              />
            </FieldRow>
            <FieldRow label="Employed from">
              <DatePicker
                value={draft.employmentStart}
                onValueChange={(value) =>
                  patch({ employmentStart: value ?? todayKey() })
                }
                aria-label="Employment start"
              />
            </FieldRow>
          </div>
          {salaryPreview && (
            <div className="space-y-0.5 text-[11px] tabular-nums text-muted-foreground">
              {salaryPreview.lines.map((line) => (
                <div key={line.lineId} className="flex justify-between">
                  <span>{line.name}</span>
                  <span>−{money(line.amountMinor, draft.currency)}</span>
                </div>
              ))}
              <div className="flex justify-between font-medium text-foreground">
                <span>Net / month</span>
                <span>{money(salaryPreview.netMinor, draft.currency)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {!draft.isPayout && (
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <FieldRow label="Amount" htmlFor="rule-amount" className="min-w-0">
            <Input
              id="rule-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={draft.amount}
              onChange={(event) => patch({ amount: event.target.value })}
              className="text-right font-medium tabular-nums"
              placeholder="0.00"
            />
          </FieldRow>
          <FieldRow label="Currency" className="min-w-0">
            <CurrencySelect
              value={draft.currency}
              onValueChange={(value) =>
                patch({ currency: value, currencyPinned: true })
              }
            />
          </FieldRow>
        </div>
      )}

      <div
        className={cn(
          "grid gap-3",
          !draft.isPayout && "grid-cols-[minmax(0,1fr)_7rem]",
        )}
      >
        <FieldRow
          label={draft.isPayout ? "Paid into" : "Account"}
          className="min-w-0"
        >
          <Select
            value={draft.accountId}
            onValueChange={(value) => {
              const account = accounts.find((item) => item.id === value);
              patch({
                accountId: value,
                // Switching account re-suggests its currency, unless the
                // currency was picked deliberately.
                currency:
                  draft.currencyPinned || !account
                    ? draft.currency
                    : account.currency,
              });
            }}
          >
            <SelectTrigger className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        {!draft.isPayout && (
          <FieldRow label="Kind" className="min-w-0">
            <Select
              value={draft.amountKind}
              onValueChange={(value) =>
                patch({ amountKind: value as RuleDraft["amountKind"] })
              }
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="variable">Variable</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        )}
      </div>

      <div className="space-y-3 border-y py-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <FieldRow label="Cadence" className="min-w-0">
            <Select
              value={draft.cadence}
              onValueChange={(value) =>
                patch({ cadence: value as FinanceCadence })
              }
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CADENCE_LABEL) as FinanceCadence[]).map(
                  (cadence) => (
                    <SelectItem key={cadence} value={cadence}>
                      {CADENCE_LABEL[cadence]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </FieldRow>
          {showsInterval && (
            <FieldRow label="Every" htmlFor="rule-interval">
              <div className="flex items-center gap-2">
                <Input
                  id="rule-interval"
                  type="number"
                  min={1}
                  max={99}
                  value={draft.interval}
                  onChange={(event) => patch({ interval: event.target.value })}
                  className="w-16 tabular-nums"
                />
                <span className="text-xs text-muted-foreground">
                  {INTERVAL_UNIT[draft.cadence]}
                </span>
              </div>
            </FieldRow>
          )}
        </div>

        {draft.cadence === "weekly" && (
          <FieldRow label="On">
            <Select
              value={String(draft.weekday)}
              onValueChange={(value) => patch({ weekday: Number(value) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((name, index) => (
                  <SelectItem key={name} value={String(index)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
        )}

        {draft.cadence === "yearly" && (
          <FieldRow label="Month">
            <Select
              value={String(draft.month)}
              onValueChange={(value) => patch({ month: Number(value) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((name, index) => (
                  <SelectItem key={name} value={String(index + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
        )}

        {showsDayOfMonth && (
          <div className="grid grid-cols-2 gap-3">
            <FieldRow
              label={draft.cadence === "semiMonthly" ? "First day" : "Day"}
              htmlFor="rule-day"
            >
              <Input
                id="rule-day"
                type="number"
                min={1}
                max={31}
                value={draft.dayOfMonth}
                onChange={(event) =>
                  patch({ dayOfMonth: Number(event.target.value) })
                }
                className="tabular-nums"
              />
            </FieldRow>
            {draft.cadence === "semiMonthly" && (
              <FieldRow label="Second day" htmlFor="rule-day-2">
                <Input
                  id="rule-day-2"
                  type="number"
                  min={1}
                  max={31}
                  value={draft.secondDayOfMonth}
                  onChange={(event) =>
                    patch({ secondDayOfMonth: Number(event.target.value) })
                  }
                  className="tabular-nums"
                />
              </FieldRow>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FieldRow label={draft.isPayout ? "First payout" : "Starts"}>
            <DatePicker
              value={draft.anchorDate}
              onValueChange={(value) =>
                patch({ anchorDate: value ?? todayKey() })
              }
              aria-label="Anchor date"
            />
          </FieldRow>
          <FieldRow label="Ends">
            <DatePicker
              clearable
              value={draft.endDate}
              onValueChange={(value) => patch({ endDate: value })}
              placeholder="Never"
              aria-label="End date"
            />
          </FieldRow>
        </div>

        <div className="space-y-1 text-[11px] text-muted-foreground">
          <div>{describeRecurrence(recurrence)}</div>
          <div className="flex flex-col gap-0.5 tabular-nums">
            {preview.length === 0 ? (
              <span>no upcoming dates</span>
            ) : (
              preview.map((date) => {
                const period = payoutPreview.find((row) => row.date === date);
                return (
                  <span key={date}>
                    → {shortDay(date)}
                    {period &&
                      ` · hours ${shortDay(period.periodStart)} – ${shortDay(period.periodEnd)}${period.partial ? " (partial)" : ""}`}
                  </span>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Tolerance %" htmlFor="rule-tolerance">
          <Input
            id="rule-tolerance"
            type="number"
            min={0}
            max={100}
            value={draft.tolerancePercent}
            onChange={(event) =>
              patch({ tolerancePercent: event.target.value })
            }
            className="tabular-nums"
          />
        </FieldRow>
        <FieldRow label="Match window (d)" htmlFor="rule-window">
          <Input
            id="rule-window"
            type="number"
            min={0}
            max={60}
            value={draft.matchWindowDays}
            onChange={(event) => patch({ matchWindowDays: event.target.value })}
            className="tabular-nums"
          />
        </FieldRow>
      </div>

      <Button
        className="w-full"
        onClick={() => void save()}
        disabled={saving || !ready}
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        {rule
          ? draft.isPayout
            ? "Save payout"
            : "Save rule"
          : draft.isPayout
            ? "Add payout"
            : "Add rule"}
      </Button>
    </div>
  );
}
