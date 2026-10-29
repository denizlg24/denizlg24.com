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
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { FilterTabs } from "@repo/ui/toolbar";
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
import { money, shortDay, todayKey } from "./finance-series";

const CADENCE_LABEL: Record<FinanceCadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  semiMonthly: "Semi-monthly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const CADENCES = Object.keys(CADENCE_LABEL) as FinanceCadence[];

type RuleKind = "expense" | "income" | "payout";

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
    // Not a hand choice: a fixed salary follows the account it is paid into.
    currencyPinned: false,
    cadence: "monthly",
    dayOfMonth: 25,
    anchorDate: firstPayout,
    tolerancePercent: "10",
    matchWindowDays: "4",
  };
}

function dayOfMonth(value: number) {
  return Math.min(31, Math.max(1, Math.round(value) || 1));
}

function buildRecurrence(draft: RuleDraft): FinanceRecurrence {
  const interval = Math.max(1, Number(draft.interval) || 1);
  const day = dayOfMonth(draft.dayOfMonth);
  switch (draft.cadence) {
    case "daily":
      return { cadence: "daily", interval };
    case "weekly":
      return { cadence: "weekly", interval, weekday: draft.weekday };
    case "semiMonthly":
      return {
        cadence: "semiMonthly",
        firstDay: day,
        secondDay: dayOfMonth(draft.secondDayOfMonth),
      };
    case "monthly":
      return { cadence: "monthly", interval, dayOfMonth: day };
    case "yearly":
      return {
        cadence: "yearly",
        interval,
        month: draft.month,
        dayOfMonth: day,
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
  const amountMajor = Number(draft.amount);
  const amountValid = Number.isFinite(amountMajor) && amountMajor > 0;
  const payoutReady =
    draft.isPayout && draft.payoutSource === "hours"
      ? Boolean(selectedJob)
      : amountValid;
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
    draft.isPayout && draft.payoutSource === "fixed" && amountValid
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
    if (!ready || saving) return;
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

  const kind: RuleKind = draft.isPayout ? "payout" : draft.direction;
  const kindOptions: { value: RuleKind; label: string }[] = [
    { value: "expense", label: "Expense" },
    { value: "income", label: "Income" },
    ...(rule ? [] : [{ value: "payout" as const, label: "Payout" }]),
  ];

  function selectKind(next: RuleKind) {
    if (next === "payout") {
      setDraft((current) => {
        const defaults = payoutDefaults(true, jobs, profiles, todayKey());
        return {
          ...current,
          ...defaults,
          name: current.name || defaults.name || "",
        };
      });
      return;
    }
    patch({ direction: next, isPayout: false });
  }

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void save();
        }
      }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {!rule?.payout && (
            <FilterTabs
              value={kind}
              onChange={selectKind}
              options={kindOptions}
            />
          )}
          {seed && !rule && (
            <span className="text-xs tabular-nums text-muted-foreground">
              every {seed.intervalDays}d · {Math.round(seed.confidence * 100)}%
              confidence
            </span>
          )}
        </div>
        <FormGrid>
          <FormField label="Name" htmlFor="rule-name" className="sm:col-span-2">
            <Input
              id="rule-name"
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </FormField>

          {!draft.isPayout && (
            <>
              <FormField label="Amount" htmlFor="rule-amount">
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
              </FormField>
              <FormField label="Currency">
                <CurrencySelect
                  value={draft.currency}
                  onValueChange={(value) =>
                    patch({ currency: value, currencyPinned: true })
                  }
                />
              </FormField>
            </>
          )}

          <FormField label={draft.isPayout ? "Paid into" : "Account"}>
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
          </FormField>
          {!draft.isPayout && (
            <FormField label="Kind">
              <Select
                value={draft.amountKind}
                onValueChange={(value) =>
                  patch({
                    amountKind: value === "variable" ? "variable" : "fixed",
                  })
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
            </FormField>
          )}
        </FormGrid>
      </div>

      {draft.isPayout && (
        <Section title="Payout">
          <FormGrid>
            <FormField label="Gross from">
              <Select
                value={draft.payoutSource}
                onValueChange={(value) => {
                  const source: RuleDraft["payoutSource"] =
                    value === "fixed" ? "fixed" : "hours";
                  const job = jobs.find((item) => item.id === draft.jobId);
                  const account = accounts.find(
                    (item) => item.id === draft.accountId,
                  );
                  patch({
                    payoutSource: source,
                    // Hours pay in the job's currency; a salary in the one
                    // chosen for it, else the receiving account's.
                    currency:
                      source === "hours"
                        ? (job?.currency ?? draft.currency)
                        : draft.currencyPinned || !account
                          ? draft.currency
                          : account.currency,
                  });
                }}
              >
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="fixed">Fixed salary</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {draft.payoutSource === "hours" ? (
              <FormField label="Job">
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
              </FormField>
            ) : (
              <FormField label="Monthly gross">
                <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    aria-label="Monthly gross"
                    value={draft.amount}
                    onChange={(event) => patch({ amount: event.target.value })}
                    className="min-w-0 text-right font-medium tabular-nums"
                    placeholder="0.00"
                  />
                  <CurrencySelect
                    value={draft.currency}
                    onValueChange={(value) =>
                      patch({ currency: value, currencyPinned: true })
                    }
                  />
                </div>
              </FormField>
            )}
            <FormField label="Deductions" className="sm:col-span-2">
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
            </FormField>
            <FormField label="Hours close on" htmlFor="rule-close-day">
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
            </FormField>
            <FormField label="Employed from">
              <DatePicker
                value={draft.employmentStart}
                onValueChange={(value) =>
                  patch({ employmentStart: value ?? todayKey() })
                }
                aria-label="Employment start"
              />
            </FormField>
          </FormGrid>
          {salaryPreview && (
            <div className="flex flex-col gap-0.5 text-xs tabular-nums text-muted-foreground">
              {salaryPreview.lines.map((line) => (
                <div key={line.lineId} className="flex justify-between">
                  <span>{line.name}</span>
                  <span>−{money(line.amountMinor, draft.currency)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1 font-medium text-accent-strong">
                <span>Net / month</span>
                <span>{money(salaryPreview.netMinor, draft.currency)}</span>
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title="Schedule">
        <FormGrid>
          <FormField label="Cadence">
            <Select
              value={draft.cadence}
              onValueChange={(value) => {
                const cadence = CADENCES.find((item) => item === value);
                if (cadence) patch({ cadence });
              }}
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CADENCES.map((cadence) => (
                  <SelectItem key={cadence} value={cadence}>
                    {CADENCE_LABEL[cadence]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {showsInterval && (
            <FormField
              label={`Every (${INTERVAL_UNIT[draft.cadence]})`}
              htmlFor="rule-interval"
            >
              <Input
                id="rule-interval"
                type="number"
                min={1}
                max={99}
                value={draft.interval}
                onChange={(event) => patch({ interval: event.target.value })}
                className="tabular-nums"
              />
            </FormField>
          )}

          {draft.cadence === "weekly" && (
            <FormField label="On">
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
            </FormField>
          )}

          {draft.cadence === "yearly" && (
            <FormField label="Month">
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
            </FormField>
          )}

          {showsDayOfMonth && (
            <FormField
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
            </FormField>
          )}
          {draft.cadence === "semiMonthly" && (
            <FormField label="Second day" htmlFor="rule-day-2">
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
            </FormField>
          )}

          <FormField label={draft.isPayout ? "First payout" : "Starts"}>
            <DatePicker
              value={draft.anchorDate}
              onValueChange={(value) =>
                patch({ anchorDate: value ?? todayKey() })
              }
              aria-label="Anchor date"
            />
          </FormField>
          <FormField label="Ends">
            <DatePicker
              clearable
              value={draft.endDate}
              onValueChange={(value) => patch({ endDate: value })}
              placeholder="Never"
              aria-label="End date"
            />
          </FormField>
        </FormGrid>

        <div className="flex flex-col gap-0.5 text-xs tabular-nums text-muted-foreground">
          <span className="text-accent-strong">
            {describeRecurrence(recurrence)}
          </span>
          {preview.length === 0 ? (
            <span>No upcoming dates</span>
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
      </Section>

      <Section title="Matching">
        <FormGrid>
          <FormField label="Tolerance %" htmlFor="rule-tolerance">
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
          </FormField>
          <FormField label="Match window (days)" htmlFor="rule-window">
            <Input
              id="rule-window"
              type="number"
              min={0}
              max={60}
              value={draft.matchWindowDays}
              onChange={(event) =>
                patch({ matchWindowDays: event.target.value })
              }
              className="tabular-nums"
            />
          </FormField>
        </FormGrid>
      </Section>

      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={saving || !ready}>
          {saving && <Loader2 className="animate-spin" />}
          {rule
            ? draft.isPayout
              ? "Save payout"
              : "Save rule"
            : draft.isPayout
              ? "Add payout"
              : "Add rule"}
        </Button>
      </div>
    </form>
  );
}
