import type {
  FinanceBudgetAlertKind,
  FinanceBudgetAlertSeverity,
  FinanceBudgetAlert as FinanceBudgetAlertWire,
} from "@repo/schemas";
import { formatMoney } from "@repo/utils";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceBudgetAlert,
  FinanceRecurringRule,
  type IFinanceBudgetAlert,
} from "@/models/Finance";
import {
  type BudgetSnapshot,
  currentMonthBounds,
  getBudgetSnapshot,
} from "./budget-overview";
import { describePeriod } from "./envelope-math";

/**
 * Budget alerts.
 *
 * Every alert is derived, never hand-written, and carries a `key` that is
 * stable for the thing it is about — envelope, period, kind. Evaluation is
 * therefore idempotent: running it twice updates one row instead of stacking
 * duplicates, and anything that was open last run but is not produced this run
 * is resolved rather than left to nag forever.
 *
 * Acknowledging suppresses an alert without deleting it, and the severity at
 * the time is recorded so a *worsening* condition reopens: acknowledging
 * "projected to overspend" should not silence "actually overspent".
 *
 * The text is generated here, not by a model. An alert that fires on a cron
 * must be cheap, deterministic and identical every time it renders; the model
 * is used for suggestions, which is where judgement actually helps.
 */

export interface FinanceBudgetThresholds {
  /** Spend ÷ flat-burn pace that counts as spending too fast. */
  paceRatio: number;
  /** Ignore pace before this much of the period has elapsed — three days into
   *  a month, one big shop always looks like a catastrophe. */
  paceMinElapsed: number;
  /** Stop reporting pace once the period is nearly over; by then the
   *  projection and the overspend alerts say it better. */
  paceMaxElapsed: number;
  /** Projected overspend has to clear the limit by this much to be worth
   *  saying, as a fraction of the limit. */
  projectedOverspendMargin: number;
  /** An unbudgeted category is only worth flagging above this share of the
   *  month's total spend. */
  unbudgetedShare: number;
  /** …and above this absolute figure, in base-currency minor units. */
  unbudgetedFloorMinor: number;
  /** A fixed recurring charge rising by more than this fraction. */
  subscriptionIncrease: number;
}

export const DEFAULT_FINANCE_BUDGET_THRESHOLDS: FinanceBudgetThresholds = {
  paceRatio: 1.25,
  paceMinElapsed: 0.15,
  paceMaxElapsed: 0.85,
  projectedOverspendMargin: 0.05,
  unbudgetedShare: 0.05,
  unbudgetedFloorMinor: 5_000,
  subscriptionIncrease: 0.1,
};

interface DerivedAlert {
  key: string;
  kind: FinanceBudgetAlertKind;
  severity: FinanceBudgetAlertSeverity;
  title: string;
  detail: string;
  envelopeId?: string;
  category?: string;
  currency: string;
  periodStart?: string;
  periodEnd?: string;
  metrics: Record<string, number>;
}

const SEVERITY_RANK: Record<FinanceBudgetAlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export function serializeFinanceBudgetAlert(
  alert: IFinanceBudgetAlert,
): FinanceBudgetAlertWire {
  return {
    id: alert._id.toString(),
    key: alert.key,
    kind: alert.kind as FinanceBudgetAlertKind,
    severity: alert.severity,
    title: alert.title,
    detail: alert.detail,
    envelopeId: alert.envelopeId?.toString(),
    category: alert.category,
    currency: alert.currency,
    periodStart: alert.periodStart,
    periodEnd: alert.periodEnd,
    metrics: alert.metrics ?? {},
    status: alert.status,
    firstSeenAt: alert.firstSeenAt.toISOString(),
    lastSeenAt: alert.lastSeenAt.toISOString(),
    acknowledgedAt: alert.acknowledgedAt?.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString(),
  };
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

/** The whole detection pass, as a pure function of a snapshot. */
export function deriveFinanceBudgetAlerts(input: {
  snapshot: BudgetSnapshot;
  thresholds?: FinanceBudgetThresholds;
  /** Fixed recurring charges whose current amount has drifted upward. */
  subscriptionDrift?: Array<{
    ruleId: string;
    name: string;
    fromMinor: number;
    toMinor: number;
    currency: string;
  }>;
}): DerivedAlert[] {
  const thresholds = input.thresholds ?? DEFAULT_FINANCE_BUDGET_THRESHOLDS;
  const { snapshot } = input;
  const money = (amount: number) => formatMoney(amount, snapshot.currency);
  const alerts: DerivedAlert[] = [];

  for (const status of snapshot.statuses) {
    const scope = `${status.envelopeId}:${status.periodStart}`;
    const allowance = status.limitMinor + status.carryInMinor;

    if (status.kind === "sinking") {
      const saved = status.savedMinor ?? 0;
      const required = status.requiredPerPeriodMinor ?? 0;
      const periodsRemaining = status.periodsRemaining ?? 0;
      if (required > 0 && !status.onTrack) {
        // Nothing left to spread the shortfall over is a different problem
        // from being behind on the plan, and reads as critical.
        const severity: FinanceBudgetAlertSeverity =
          periodsRemaining === 0 ? "critical" : "warning";
        alerts.push({
          key: `sinking_underfunded:${scope}`,
          kind: "sinking_underfunded",
          severity,
          title: `${status.name} needs ${money(required)}`,
          detail:
            periodsRemaining === 0
              ? `${money(saved)} of ${money(status.limitMinor)} saved and no ${describePeriod(status.period)}s left before the target date.`
              : `${money(saved)} of ${money(status.limitMinor)} saved. ${money(required)} per ${describePeriod(status.period)} over ${periodsRemaining} more to reach it.`,
          envelopeId: status.envelopeId,
          currency: status.currency,
          periodStart: status.periodStart,
          periodEnd: status.periodEnd,
          metrics: {
            savedMinor: saved,
            targetMinor: status.limitMinor,
            requiredPerPeriodMinor: required,
            periodsRemaining,
          },
        });
      }
      continue;
    }

    if (allowance > 0 && status.spentMinor > allowance) {
      const overMinor = status.spentMinor - allowance;
      alerts.push({
        key: `envelope_exceeded:${scope}`,
        kind: "envelope_exceeded",
        severity: "critical",
        title: `${status.name} over by ${money(overMinor)}`,
        detail: `${money(status.spentMinor)} spent against ${money(allowance)} with ${pct(1 - status.elapsedFraction)} of the ${describePeriod(status.period)} left.`,
        envelopeId: status.envelopeId,
        currency: status.currency,
        periodStart: status.periodStart,
        periodEnd: status.periodEnd,
        metrics: {
          spentMinor: status.spentMinor,
          allowanceMinor: allowance,
          overMinor,
          elapsedFraction: status.elapsedFraction,
        },
      });
      continue;
    }

    if (
      allowance > 0 &&
      status.projectedMinor >
        allowance * (1 + thresholds.projectedOverspendMargin) &&
      status.elapsedFraction >= thresholds.paceMinElapsed
    ) {
      const overMinor = status.projectedMinor - allowance;
      alerts.push({
        key: `envelope_projected_overspend:${scope}`,
        kind: "envelope_projected_overspend",
        severity: "warning",
        title: `${status.name} heading ${money(overMinor)} over`,
        detail: `${money(status.spentMinor)} spent and ${money(status.committedMinor)} committed; on this rate the ${describePeriod(status.period)} ends at ${money(status.projectedMinor)} against ${money(allowance)}.`,
        envelopeId: status.envelopeId,
        currency: status.currency,
        periodStart: status.periodStart,
        periodEnd: status.periodEnd,
        metrics: {
          projectedMinor: status.projectedMinor,
          allowanceMinor: allowance,
          overMinor,
          spentMinor: status.spentMinor,
          committedMinor: status.committedMinor,
        },
      });
      continue;
    }

    if (
      status.paceRatio !== null &&
      status.paceRatio >= thresholds.paceRatio &&
      status.elapsedFraction >= thresholds.paceMinElapsed &&
      status.elapsedFraction <= thresholds.paceMaxElapsed
    ) {
      alerts.push({
        key: `envelope_pace:${scope}`,
        kind: "envelope_pace",
        severity: "info",
        title: `${status.name} ${pct(status.paceRatio - 1)} ahead of pace`,
        detail: `${money(status.spentMinor)} spent ${pct(status.elapsedFraction)} of the way through the ${describePeriod(status.period)}, against a limit of ${money(status.limitMinor)}.`,
        envelopeId: status.envelopeId,
        currency: status.currency,
        periodStart: status.periodStart,
        periodEnd: status.periodEnd,
        metrics: {
          paceRatio: status.paceRatio,
          spentMinor: status.spentMinor,
          limitMinor: status.limitMinor,
          elapsedFraction: status.elapsedFraction,
        },
      });
    }
  }

  const month = currentMonthBounds(snapshot.asOfDate);
  const monthSpend =
    snapshot.totals.spentMinor + snapshot.totals.unbudgetedMinor;
  for (const row of snapshot.unbudgeted) {
    if (row.spentMinor < thresholds.unbudgetedFloorMinor) continue;
    if (
      monthSpend > 0 &&
      row.spentMinor / monthSpend < thresholds.unbudgetedShare
    ) {
      continue;
    }
    const label = row.category ?? "Uncategorized";
    alerts.push({
      key: `unbudgeted_spend:${label}:${month.start}`,
      kind: "unbudgeted_spend",
      severity: "info",
      title: `${money(row.spentMinor)} on ${label} with no envelope`,
      detail: `${row.entryCount} ${row.entryCount === 1 ? "entry" : "entries"} this month, ${monthSpend > 0 ? pct(row.spentMinor / monthSpend) : "all"} of total spend, covered by no budget.`,
      category: row.category ?? undefined,
      currency: snapshot.currency,
      periodStart: month.start,
      periodEnd: month.end,
      metrics: {
        spentMinor: row.spentMinor,
        entryCount: row.entryCount,
        share: monthSpend > 0 ? row.spentMinor / monthSpend : 1,
      },
    });
  }

  const forecast = snapshot.forecast;
  if (forecast && forecast.p50Minor < 0) {
    alerts.push({
      key: `runway_low:${month.start}`,
      kind: "runway_low",
      severity: forecast.p75Minor < 0 ? "critical" : "warning",
      title: `Month ends at ${money(forecast.p50Minor)}`,
      detail: `${money(forecast.currentBalanceMinor)} now, ${money(forecast.recurringExpensesDueMinor)} of recurring charges still due and ${money(forecast.expectedIncomeMinor)} of income expected over ${forecast.daysRemaining} days.`,
      currency: snapshot.currency,
      periodStart: month.start,
      periodEnd: month.end,
      metrics: {
        p25Minor: forecast.p25Minor,
        p50Minor: forecast.p50Minor,
        p75Minor: forecast.p75Minor,
        currentBalanceMinor: forecast.currentBalanceMinor,
        daysRemaining: forecast.daysRemaining,
      },
    });
  }

  // Expected income whose match window has closed with nothing landing on it.
  // The salary not arriving is worth knowing before the direct debits fail.
  // Reads `allRows`: a `missed` projection is dropped by deduplication, and it
  // is the clearest case of exactly what this alert is for.
  for (const row of snapshot.ledger.allRows) {
    if (row.origin !== "projected") continue;
    if (row.state !== "expected" && row.state !== "missed") continue;
    if (row.amountMinor <= 0) continue;
    if (row.expectedWindowEnd >= snapshot.asOfDate) continue;
    alerts.push({
      key: `income_missed:${row.id}`,
      kind: "income_missed",
      severity: "warning",
      title: `${money(row.amountMinor)} expected income has not landed`,
      detail: `${row.descriptor} was due by ${row.expectedWindowEnd} and no matching transaction has been seen.`,
      currency: snapshot.currency,
      periodStart: row.expectedWindowStart,
      periodEnd: row.expectedWindowEnd,
      metrics: { amountMinor: row.amountMinor },
    });
  }

  for (const drift of input.subscriptionDrift ?? []) {
    const increase = (drift.toMinor - drift.fromMinor) / drift.fromMinor;
    alerts.push({
      key: `subscription_increase:${drift.ruleId}:${drift.toMinor}`,
      kind: "subscription_increase",
      severity: "info",
      title: `${drift.name} rose to ${formatMoney(drift.toMinor, drift.currency)}`,
      detail: `Charged ${formatMoney(drift.fromMinor, drift.currency)} before — ${formatMoney(drift.toMinor - drift.fromMinor, drift.currency)} more, ${pct(increase)} up. The recurring rule still says the old amount.`,
      currency: drift.currency,
      metrics: {
        fromMinor: drift.fromMinor,
        toMinor: drift.toMinor,
        increase,
      },
    });
  }

  return alerts;
}

/**
 * Fixed recurring charges that are now billing more than the rule says.
 *
 * Compares the rule's recorded amount against the most recent bank row matched
 * to it. Only `fixed` rules qualify — a `variable` rule is one whose amount is
 * expected to move, so drift there is not news.
 */
export async function detectSubscriptionDrift(snapshot: BudgetSnapshot) {
  await connectDB();
  const rules = await FinanceRecurringRule.find({
    status: "active",
    amountKind: "fixed",
    direction: "expense",
  });
  const drift: Array<{
    ruleId: string;
    name: string;
    fromMinor: number;
    toMinor: number;
    currency: string;
  }> = [];
  // Undeduplicated: a projection that matched a bank row is dropped from
  // `rows`, and that pair is the only thing that can show drift.
  const byId = new Map(snapshot.ledger.allRows.map((row) => [row.id, row]));

  for (const rule of rules) {
    const ruleId = rule._id.toString();
    // Projections carry the rule id; the bank row they linked to is what was
    // actually charged, which is the only number that can have drifted.
    const linked = snapshot.ledger.allRows
      .filter(
        (row) =>
          row.origin === "projected" &&
          row.recurringRuleId === ruleId &&
          row.state === "linked" &&
          row.linkedLedgerId,
      )
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const latest = linked[0];
    if (!latest?.linkedLedgerId) continue;
    const actual = byId.get(latest.linkedLedgerId);
    if (!actual) continue;
    const charged = Math.abs(actual.amountMinor);
    if (rule.amountMinor <= 0) continue;
    const increase = (charged - rule.amountMinor) / rule.amountMinor;
    if (increase <= DEFAULT_FINANCE_BUDGET_THRESHOLDS.subscriptionIncrease) {
      continue;
    }
    drift.push({
      ruleId,
      name: rule.name,
      fromMinor: rule.amountMinor,
      toMinor: charged,
      currency: actual.currency,
    });
  }
  return drift;
}

export interface FinanceBudgetAlertEvaluation {
  evaluatedAt: string;
  opened: number;
  updated: number;
  resolved: number;
  reopened: number;
  alerts: FinanceBudgetAlertWire[];
}

/**
 * Reconciles the derived set against what is stored.
 *
 * The three-way outcome is the point: a condition that persists updates its
 * row (keeping `firstSeenAt`, so "since when" survives), a condition that has
 * gone resolves, and a condition that got worse reopens an acknowledgement
 * that was only ever about the milder version.
 */
export async function evaluateFinanceBudgetAlerts(
  now = new Date(),
): Promise<FinanceBudgetAlertEvaluation> {
  await connectDB();
  const snapshot = await getBudgetSnapshot(now);
  const subscriptionDrift = await detectSubscriptionDrift(snapshot);
  const derived = deriveFinanceBudgetAlerts({ snapshot, subscriptionDrift });

  const existing = await FinanceBudgetAlert.find({
    status: { $in: ["open", "acknowledged"] },
  });
  const existingByKey = new Map(existing.map((alert) => [alert.key, alert]));
  const derivedKeys = new Set(derived.map((alert) => alert.key));

  let opened = 0;
  let updated = 0;
  let reopened = 0;

  for (const alert of derived) {
    const stored = existingByKey.get(alert.key);
    if (!stored) {
      await FinanceBudgetAlert.updateOne(
        { key: alert.key },
        {
          $set: {
            ...alert,
            envelopeId: alert.envelopeId
              ? new mongoose.Types.ObjectId(alert.envelopeId)
              : undefined,
            status: "open",
            lastSeenAt: now,
          },
          // $unset, not $set to undefined: Mongoose strips undefined from a
          // $set, so a resolved alert firing again would keep its old
          // resolvedAt and read as closed while being open.
          $unset: {
            resolvedAt: "",
            acknowledgedAt: "",
            acknowledgedSeverity: "",
          },
          $setOnInsert: { firstSeenAt: now },
        },
        { upsert: true },
      );
      opened += 1;
      continue;
    }

    const escalated =
      stored.status === "acknowledged" &&
      SEVERITY_RANK[alert.severity] >
        SEVERITY_RANK[stored.acknowledgedSeverity ?? stored.severity];
    stored.severity = alert.severity;
    stored.title = alert.title;
    stored.detail = alert.detail;
    stored.metrics = alert.metrics;
    stored.lastSeenAt = now;
    if (escalated) {
      stored.status = "open";
      stored.acknowledgedAt = undefined;
      stored.acknowledgedSeverity = undefined;
      reopened += 1;
    } else {
      updated += 1;
    }
    await stored.save();
  }

  const stale = existing.filter((alert) => !derivedKeys.has(alert.key));
  if (stale.length) {
    await FinanceBudgetAlert.updateMany(
      { _id: { $in: stale.map((alert) => alert._id) } },
      { $set: { status: "resolved", resolvedAt: now } },
    );
  }

  return {
    evaluatedAt: now.toISOString(),
    opened,
    updated,
    resolved: stale.length,
    reopened,
    alerts: await listFinanceBudgetAlerts({ status: ["open", "acknowledged"] }),
  };
}

export async function listFinanceBudgetAlerts(
  options: {
    status?: Array<"open" | "acknowledged" | "resolved">;
    severity?: FinanceBudgetAlertSeverity[];
    kind?: FinanceBudgetAlertKind[];
    limit?: number;
  } = {},
): Promise<FinanceBudgetAlertWire[]> {
  await connectDB();
  const alerts = await FinanceBudgetAlert.find({
    status: { $in: options.status ?? ["open"] },
    ...(options.severity?.length
      ? { severity: { $in: options.severity } }
      : {}),
    ...(options.kind?.length ? { kind: { $in: options.kind } } : {}),
  })
    // Ordered by recency in the query and by severity below: Mongo would sort
    // severity as a string ("warning" > "info" > "critical"), so limiting on
    // that would drop the critical rows this exists to surface.
    .sort({ lastSeenAt: -1 })
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 200));
  return alerts
    .map(serializeFinanceBudgetAlert)
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.lastSeenAt.localeCompare(a.lastSeenAt),
    );
}

export async function countOpenFinanceBudgetAlerts() {
  await connectDB();
  const rows = await FinanceBudgetAlert.aggregate<{
    _id: FinanceBudgetAlertSeverity;
    count: number;
  }>([
    { $match: { status: "open" } },
    { $group: { _id: "$severity", count: { $sum: 1 } } },
  ]);
  const bySeverity = { info: 0, warning: 0, critical: 0 };
  for (const row of rows) bySeverity[row._id] = row.count;
  return {
    ...bySeverity,
    total: bySeverity.info + bySeverity.warning + bySeverity.critical,
  };
}

export async function decideFinanceBudgetAlert(
  id: string,
  action: "acknowledge" | "reopen" | "resolve",
  now = new Date(),
) {
  await connectDB();
  if (!mongoose.isValidObjectId(id)) return null;
  const alert = await FinanceBudgetAlert.findById(id);
  if (!alert) return null;
  if (action === "acknowledge") {
    alert.status = "acknowledged";
    alert.acknowledgedAt = now;
    // Remembering the severity is what lets a worsening condition reopen.
    alert.acknowledgedSeverity = alert.severity;
    alert.resolvedAt = undefined;
  } else if (action === "resolve") {
    alert.status = "resolved";
    alert.resolvedAt = now;
  } else {
    alert.status = "open";
    alert.acknowledgedAt = undefined;
    alert.acknowledgedSeverity = undefined;
    alert.resolvedAt = undefined;
  }
  await alert.save();
  return serializeFinanceBudgetAlert(alert);
}
