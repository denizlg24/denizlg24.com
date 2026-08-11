import {
  type AlertAggregate,
  type AlertRule,
  type AlertRuleCreate,
  type AlertRuleUnit,
  type AlertRuleUpdate,
  COMPARISON_LABELS,
  compare,
  DEFAULT_ALERT_RULES,
  type MetricCatalogEntry,
} from "@repo/schemas/cloud";
import { asc, eq, sql } from "drizzle-orm";

import type { Database } from "../db";
import { type AlertRuleRow, alertRules, metricsSamples } from "../db/schema";
import { compareMetricGroups, describeMetricSeries } from "./metric-labels";

function toAlertRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    series: row.series,
    aggregate: row.aggregate,
    windowSeconds: row.windowSeconds,
    comparison: row.comparison,
    threshold: row.threshold,
    forSeconds: row.forSeconds,
    severity: row.severity,
    cooldownMinutes: row.cooldownMinutes,
    unit: row.unit,
    state: row.state,
    stateSince: row.stateSince?.toISOString() ?? null,
    breachingSince: row.breachingSince?.toISOString() ?? null,
    lastValue: row.lastValue,
    lastEvaluatedAt: row.lastEvaluatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAlertRules(db: Database): Promise<AlertRule[]> {
  const rows = await db
    .select()
    .from(alertRules)
    .orderBy(asc(alertRules.name), asc(alertRules.id));
  return rows.map(toAlertRule);
}

export async function createAlertRule(
  db: Database,
  input: AlertRuleCreate,
): Promise<AlertRule> {
  const rows = await db.insert(alertRules).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to create alert rule");
  return toAlertRule(row);
}

/**
 * Editing the condition clears the evaluation state. A rule that was firing on
 * a 70% threshold is not meaningfully "still firing" once the threshold moves
 * to 90 — keeping the old state would suppress the next real breach for a whole
 * cooldown, and would report a recovery that never happened.
 */
const CONDITION_FIELDS = [
  "series",
  "aggregate",
  "windowSeconds",
  "comparison",
  "threshold",
  "forSeconds",
] as const satisfies readonly (keyof AlertRuleUpdate)[];

export async function updateAlertRule(
  db: Database,
  id: string,
  input: AlertRuleUpdate,
): Promise<AlertRule | null> {
  const conditionChanged = CONDITION_FIELDS.some(
    (field) => input[field] !== undefined,
  );
  const rows = await db
    .update(alertRules)
    .set({
      ...input,
      updatedAt: new Date(),
      ...(conditionChanged
        ? { state: "ok" as const, breachingSince: null, stateSince: null }
        : {}),
      // Disabling a rule must not leave it stuck "firing" in the UI, and
      // re-enabling must start from a clean slate rather than replay.
      ...(input.enabled === false
        ? { state: "ok" as const, breachingSince: null }
        : {}),
    })
    .where(eq(alertRules.id, id))
    .returning();
  const row = rows[0];
  return row ? toAlertRule(row) : null;
}

export async function deleteAlertRule(
  db: Database,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(alertRules)
    .where(eq(alertRules.id, id))
    .returning({ id: alertRules.id });
  return rows.length > 0;
}

/**
 * Seeds the shipped defaults for each metric family that has no rule at all.
 *
 * The family — the `kind` before the colon — is the unit of seeding rather than
 * the individual rule, and that is the whole design. Seeding per rule would
 * resurrect every rule the owner ever deleted on the next restart; seeding once
 * per database, as this did, means defaults shipped for a machine added later
 * never arrive at all, because the table has had rules in it since the day the
 * Pi was the only host. Per family, a new collector's defaults land the first
 * time it is deployed and nothing already tuned is touched.
 *
 * The edge it accepts: deleting every rule of a family brings that family's
 * defaults back. Deleting all of them is indistinguishable from never having
 * had them, and the alternative is a marker table for a single-user cloud.
 */
export async function seedDefaultAlertRules(db: Database): Promise<number> {
  const existing = await db
    .select({ series: alertRules.series })
    .from(alertRules);
  const present = new Set(existing.map((row) => splitSeries(row.series).kind));
  const missing = DEFAULT_ALERT_RULES.filter(
    (rule) => !present.has(splitSeries(rule.series).kind),
  );
  if (missing.length === 0) return 0;
  const rows = await db
    .insert(alertRules)
    .values([...missing])
    .returning({ id: alertRules.id });
  return rows.length;
}

const AGGREGATE_SQL: Record<AlertAggregate, string> = {
  last: "last",
  avg: "avg",
  max: "max",
  min: "min",
};

function splitSeries(name: string): { kind: string; key: string } {
  const separator = name.indexOf(":");
  if (separator < 1 || separator === name.length - 1) {
    throw new Error(`Invalid metric series "${name}"`);
  }
  return { kind: name.slice(0, separator), key: name.slice(separator + 1) };
}

/**
 * `last` reads the newest single sample; the others aggregate the window. Both
 * forms return null when the window holds no samples, which is treated as "no
 * opinion" rather than as a breach — an alert must not fire because a collector
 * stopped reporting.
 */
export async function aggregateSeries(
  db: Database,
  series: string,
  aggregate: AlertAggregate,
  windowSeconds: number,
  now: Date,
): Promise<number | null> {
  const { kind, key } = splitSeries(series);
  const from = new Date(now.getTime() - windowSeconds * 1_000);

  if (aggregate === "last") {
    const rows = await db
      .select({ value: metricsSamples.value })
      .from(metricsSamples)
      .where(
        sql`${metricsSamples.kind} = ${kind}
          AND ${metricsSamples.key} = ${key}
          AND ${metricsSamples.ts} >= ${from.toISOString()}::timestamptz`,
      )
      .orderBy(sql`${metricsSamples.ts} DESC`)
      .limit(1);
    return rows[0]?.value ?? null;
  }

  const rows = await db.execute(sql<{ value: number | string | null }>`
    SELECT ${sql.raw(AGGREGATE_SQL[aggregate])}(${metricsSamples.value})::double precision AS value
    FROM ${metricsSamples}
    WHERE ${metricsSamples.kind} = ${kind}
      AND ${metricsSamples.key} = ${key}
      AND ${metricsSamples.ts} >= ${from.toISOString()}::timestamptz
  `);
  const value = Array.from(rows)[0]?.value;
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMetricValue(value: number, unit: AlertRuleUnit): string {
  switch (unit) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "celsius":
      return `${value.toFixed(1)}°C`;
    case "ratio":
      return value.toFixed(2);
    case "bytes":
      return formatBytes(value);
    case "bytes_per_second":
      return `${formatBytes(value)}/s`;
    case "count":
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
}

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0 B";
  const exponent = Math.min(
    BYTE_UNITS.length - 1,
    Math.floor(Math.log(Math.abs(value)) / Math.log(1_024)),
  );
  const scaled = value / 1_024 ** exponent;
  return `${scaled.toFixed(exponent === 0 ? 0 : 1)} ${BYTE_UNITS[exponent]}`;
}

export function describeCondition(
  rule: Pick<
    AlertRule,
    "aggregate" | "windowSeconds" | "comparison" | "threshold" | "unit"
  >,
): string {
  const window = `${Math.round(rule.windowSeconds / 60)}m`;
  return `${rule.aggregate}(${window}) ${COMPARISON_LABELS[rule.comparison]} ${formatMetricValue(rule.threshold, rule.unit)}`;
}

export type AlertRuleTransition =
  | "fired"
  | "resolved"
  | "still_firing"
  | "none";

export interface AlertRuleEvaluation {
  rule: AlertRule;
  value: number | null;
  breaching: boolean;
  transition: AlertRuleTransition;
}

/**
 * Pure so the state machine can be tested without Postgres. `breachingSince` is
 * carried on the rule rather than recomputed, which is what lets `forSeconds`
 * survive a restart mid-breach.
 */
export function nextRuleState(
  rule: AlertRule,
  value: number | null,
  now: Date,
): {
  transition: AlertRuleTransition;
  breaching: boolean;
  state: AlertRule["state"];
  breachingSince: Date | null;
} {
  if (value === null) {
    // No samples: hold whatever state the rule already had. Resolving here
    // would announce a recovery on the strength of a collector going quiet.
    return {
      transition: "none",
      breaching: false,
      state: rule.state,
      breachingSince: rule.breachingSince
        ? new Date(rule.breachingSince)
        : null,
    };
  }

  const breaching = compare(value, rule.comparison, rule.threshold);

  if (!breaching) {
    return {
      transition: rule.state === "firing" ? "resolved" : "none",
      breaching: false,
      state: "ok",
      breachingSince: null,
    };
  }

  const breachingSince = rule.breachingSince
    ? new Date(rule.breachingSince)
    : now;

  if (rule.state === "firing") {
    return {
      transition: "still_firing",
      breaching: true,
      state: "firing",
      breachingSince,
    };
  }

  const sustained =
    now.getTime() - breachingSince.getTime() >= rule.forSeconds * 1_000;
  return {
    transition: sustained ? "fired" : "none",
    breaching: true,
    state: sustained ? "firing" : "ok",
    breachingSince,
  };
}

export async function persistRuleState(
  db: Database,
  rule: AlertRule,
  result: ReturnType<typeof nextRuleState>,
  value: number | null,
  now: Date,
): Promise<void> {
  await db
    .update(alertRules)
    .set({
      state: result.state,
      breachingSince: result.breachingSince,
      lastValue: value,
      lastEvaluatedAt: now,
      ...(result.state !== rule.state ? { stateSince: now } : {}),
    })
    .where(eq(alertRules.id, rule.id));
}

/**
 * The distinct series the sampler has actually written recently, so the rule
 * editor offers real targets instead of a hand-maintained list that drifts from
 * the collectors.
 */
export async function metricCatalog(
  db: Database,
  options: {
    sinceHours?: number;
    /** Container id to name, so the picker never shows a bare sha. */
    containerNames?: ReadonlyMap<string, string>;
  } = {},
): Promise<MetricCatalogEntry[]> {
  const since = new Date(
    Date.now() - (options.sinceHours ?? 48) * 60 * 60 * 1_000,
  );
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (kind, key)
      kind || ':' || key AS name,
      value,
      ts
    FROM ${metricsSamples}
    WHERE ts >= ${since.toISOString()}::timestamptz
    ORDER BY kind, key, ts DESC
  `);

  const entries: MetricCatalogEntry[] = [];
  for (const row of Array.from(rows)) {
    if (typeof row !== "object" || row === null) continue;
    const name = Reflect.get(row, "name");
    if (typeof name !== "string") continue;

    const rawValue = Reflect.get(row, "value");
    const value = Number(rawValue);
    const rawTs = Reflect.get(row, "ts");
    const seenAt =
      rawTs instanceof Date
        ? rawTs
        : typeof rawTs === "string"
          ? new Date(rawTs)
          : null;

    const description = describeMetricSeries(name, {
      containerNames: options.containerNames,
    });

    entries.push({
      name,
      ...description,
      lastValue: Number.isFinite(value) ? value : null,
      lastSeenAt:
        seenAt && !Number.isNaN(seenAt.getTime()) ? seenAt.toISOString() : null,
    });
  }
  return entries.sort(
    (a, b) =>
      compareMetricGroups(a.group, b.group) || a.label.localeCompare(b.label),
  );
}
