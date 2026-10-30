import {
  VIEW_FILTER_OPS_BY_TYPE,
  VIEW_UNARY_OPS,
  type ViewConfig,
  type ViewFieldDef,
  type ViewFilter,
  type ViewGroup,
  type ViewMoney,
  type ViewPerson,
  type ViewQueryResult,
  type ViewRow,
  type ViewSourceDescriptor,
  type ViewTotal,
  type ViewValue,
  viewGroupField,
} from "@repo/schemas";

/*
 * The one engine behind every module view: filter, sort, group, total and
 * page rows a source has read. Pure, so the server, tests and any client
 * agree on what a view shows. Money is totalled per currency and never
 * across currencies; a row with several values in the group field (labels,
 * tags) counts in each of their groups.
 */

const OPTIONS_MAX = 50;

export function isMoney(value: ViewValue | undefined): value is ViewMoney {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "amountMinor" in value
  );
}

function isPeople(value: ViewValue | undefined): value is ViewPerson[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null
  );
}

/** The value as the strings a select, person or boolean field groups and filters by. */
export function valueKeys(value: ViewValue | undefined): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "boolean") return [value ? "true" : "false"];
  if (typeof value === "string") return value ? [value] : [];
  if (typeof value === "number") return [String(value)];
  if (isMoney(value)) return [String(value.amountMinor)];
  if (isPeople(value)) return value.map((p) => p.name);
  return value.filter((v): v is string => typeof v === "string" && v !== "");
}

function isEmpty(value: ViewValue | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function asText(value: ViewValue | undefined): string {
  if (typeof value === "string") return value;
  return valueKeys(value).join(" ");
}

function asNumber(value: ViewValue | undefined): number | null {
  if (typeof value === "number") return value;
  if (isMoney(value)) return value.amountMinor;
  return null;
}

function asDay(value: ViewValue | undefined): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : null;
}

function operandNumber(filter: ViewFilter): number | null {
  const { value } = filter;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function operandStrings(filter: ViewFilter): string[] {
  const { value } = filter;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  return [];
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const NEGATIVE_OPS = new Set(["not_contains", "is_not", "none_of", "neq"]);

/** Filters a field cannot take are reported, not applied. */
export function viewConfigProblems(
  descriptor: ViewSourceDescriptor,
  config: Pick<ViewConfig, "filters" | "sort" | "group" | "fields">,
): string[] {
  const problems: string[] = [];
  for (const filter of config.filters) {
    const def = descriptor.fields[filter.field];
    if (!def) {
      problems.push(`No field ${filter.field} on ${descriptor.id}`);
    } else if (!VIEW_FILTER_OPS_BY_TYPE[def.type].includes(filter.op)) {
      problems.push(`${filter.field} (${def.type}) has no ${filter.op}`);
    } else if (
      !VIEW_UNARY_OPS.includes(filter.op) &&
      filter.value === undefined
    ) {
      problems.push(`${filter.field} ${filter.op} needs a value`);
    }
  }
  for (const sort of config.sort) {
    if (!descriptor.fields[sort.field]) {
      problems.push(`No field ${sort.field} on ${descriptor.id}`);
    }
  }
  if (config.group && !viewGroupField(descriptor, { group: config.group })) {
    problems.push(`${config.group} cannot group ${descriptor.id}`);
  }
  for (const field of config.fields ?? []) {
    if (!descriptor.fields[field]) {
      problems.push(`No field ${field} on ${descriptor.id}`);
    }
  }
  return problems;
}

export function matchesFilter(
  def: ViewFieldDef,
  value: ViewValue | undefined,
  filter: ViewFilter,
  today: string,
): boolean {
  if (filter.op === "empty") return isEmpty(value);
  if (filter.op === "not_empty") return !isEmpty(value);
  if (isEmpty(value) && def.type !== "boolean") {
    return NEGATIVE_OPS.has(filter.op);
  }
  switch (def.type) {
    case "text": {
      const text = asText(value).toLowerCase();
      const operand = operandStrings(filter)[0]?.toLowerCase() ?? "";
      if (filter.op === "contains") return text.includes(operand);
      if (filter.op === "not_contains") return !text.includes(operand);
      if (filter.op === "is") return text === operand;
      if (filter.op === "is_not") return text !== operand;
      return true;
    }
    case "number":
    case "money": {
      const n = asNumber(value);
      const operand = operandNumber(filter);
      if (n === null || operand === null) return NEGATIVE_OPS.has(filter.op);
      if (filter.op === "eq") return n === operand;
      if (filter.op === "neq") return n !== operand;
      if (filter.op === "gt") return n > operand;
      if (filter.op === "gte") return n >= operand;
      if (filter.op === "lt") return n < operand;
      if (filter.op === "lte") return n <= operand;
      return true;
    }
    case "date": {
      const day = asDay(value);
      if (day === null) return false;
      if (filter.op === "past_days" || filter.op === "next_days") {
        const days = Math.max(0, Math.floor(operandNumber(filter) ?? 0));
        return filter.op === "past_days"
          ? day >= addDays(today, -days) && day <= today
          : day >= today && day <= addDays(today, days);
      }
      const operand = asDay(operandStrings(filter)[0] ?? null);
      if (operand === null) return false;
      if (filter.op === "on") return day === operand;
      if (filter.op === "before") return day < operand;
      if (filter.op === "after") return day > operand;
      if (filter.op === "on_or_before") return day <= operand;
      if (filter.op === "on_or_after") return day >= operand;
      return true;
    }
    case "boolean": {
      const operand = filter.value === true || filter.value === "true";
      return (value === true) === operand;
    }
    case "select":
    case "person": {
      const have = valueKeys(value).map((v) => v.toLowerCase());
      const want = operandStrings(filter).map((v) => v.toLowerCase());
      const hit = want.some((w) => have.includes(w));
      if (filter.op === "is" || filter.op === "any_of") return hit;
      if (filter.op === "is_not" || filter.op === "none_of") return !hit;
      return true;
    }
  }
}

function compareValues(
  def: ViewFieldDef,
  a: ViewValue | undefined,
  b: ViewValue | undefined,
): number {
  switch (def.type) {
    case "number":
    case "money":
      return (asNumber(a) ?? 0) - (asNumber(b) ?? 0);
    case "boolean":
      return Number(a === true) - Number(b === true);
    case "date":
      return (
        (asDay(a) ?? "").localeCompare(asDay(b) ?? "") ||
        String(a ?? "").localeCompare(String(b ?? ""))
      );
    case "select":
      if (def.options) {
        const ia = def.options.indexOf(valueKeys(a)[0] ?? "");
        const ib = def.options.indexOf(valueKeys(b)[0] ?? "");
        if (ia !== ib) return ia - ib;
      }
      return asText(a).localeCompare(asText(b), undefined, {
        sensitivity: "base",
      });
    default:
      return asText(a).localeCompare(asText(b), undefined, {
        sensitivity: "base",
        numeric: true,
      });
  }
}

/** Board order of group keys: fixed options first in their order, then by name, empty last. */
function groupOrder(def: ViewFieldDef, keys: Iterable<string>): string[] {
  const unique = [...new Set(keys)];
  const rank = (key: string) => {
    if (key === "") return Number.MAX_SAFE_INTEGER;
    if (def.type === "boolean") return key === "true" ? 0 : 1;
    const index = def.options?.indexOf(key) ?? -1;
    return index >= 0 ? index : (def.options?.length ?? 0);
  };
  return unique.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
  );
}

function groupKeys(value: ViewValue | undefined): string[] {
  const keys = valueKeys(value);
  return keys.length > 0 ? keys : [""];
}

function sumMoney(
  rows: readonly ViewRow[],
  moneyFields: readonly string[],
): ViewTotal[] {
  const sums = new Map<string, ViewTotal>();
  for (const row of rows) {
    for (const field of moneyFields) {
      const value = row.values[field];
      if (!isMoney(value)) continue;
      const key = `${field}\u0000${value.currency}`;
      const total = sums.get(key) ?? {
        field,
        currency: value.currency,
        amountMinor: 0,
      };
      total.amountMinor += value.amountMinor;
      sums.set(key, total);
    }
  }
  return [...sums.values()].sort(
    (a, b) =>
      a.field.localeCompare(b.field) || a.currency.localeCompare(b.currency),
  );
}

export interface RunViewOptions {
  /** `YYYY-MM-DD`: what relative date filters count from. */
  today: string;
  /** Rows per page; the view's own limit when absent. */
  limit?: number;
  /** Offset into the matching rows. */
  cursor?: number;
  /** How many rows the source read, and whether it stopped at its cap. */
  scanned?: number;
  truncated?: boolean;
}

/** The field a query groups by: the view's own, or the source's default on a board. */
export function effectiveGroup(
  descriptor: ViewSourceDescriptor,
  config: Pick<ViewConfig, "group" | "layout">,
): string | null {
  if (!config.group && config.layout !== "board") return null;
  return viewGroupField(descriptor, config);
}

export function runViewQuery(
  descriptor: ViewSourceDescriptor,
  rows: readonly ViewRow[],
  config: ViewConfig,
  options: RunViewOptions,
): ViewQueryResult {
  const { fields } = descriptor;
  const filters = config.filters.filter((filter) => {
    const def = fields[filter.field];
    return (
      def !== undefined &&
      VIEW_FILTER_OPS_BY_TYPE[def.type].includes(filter.op) &&
      (VIEW_UNARY_OPS.includes(filter.op) || filter.value !== undefined)
    );
  });
  const matched = rows.filter((row) =>
    filters.every((filter) => {
      const def = fields[filter.field];
      return def
        ? matchesFilter(def, row.values[filter.field], filter, options.today)
        : true;
    }),
  );

  const sorts = [...config.sort, descriptor.defaultSort].filter(
    (sort) => fields[sort.field] !== undefined,
  );
  const group = effectiveGroup(descriptor, config);
  const groupDef = group ? fields[group] : undefined;
  const order = groupDef
    ? groupOrder(
        groupDef,
        matched.flatMap((row) => groupKeys(row.values[group ?? ""])),
      )
    : [];
  const groupRank = new Map(order.map((key, index) => [key, index]));

  const sorted = [...matched].sort((a, b) => {
    if (group) {
      const ga = groupRank.get(groupKeys(a.values[group])[0] ?? "") ?? 0;
      const gb = groupRank.get(groupKeys(b.values[group])[0] ?? "") ?? 0;
      if (ga !== gb) return ga - gb;
    }
    for (const sort of sorts) {
      const def = fields[sort.field];
      if (!def) continue;
      const va = a.values[sort.field];
      const vb = b.values[sort.field];
      // Empty values sort last whichever way the column runs.
      const ea = isEmpty(va);
      const eb = isEmpty(vb);
      if (ea !== eb) return ea ? 1 : -1;
      if (ea) continue;
      const cmp = compareValues(def, va, vb);
      if (cmp !== 0) return sort.dir === "asc" ? cmp : -cmp;
    }
    return a.id.localeCompare(b.id);
  });

  const moneyFields = Object.entries(fields)
    .filter(([, def]) => def.type === "money")
    .map(([key]) => key);

  const groups: ViewGroup[] = group
    ? order.map((key) => {
        const members = sorted.filter((row) =>
          groupKeys(row.values[group]).includes(key),
        );
        return {
          key,
          count: members.length,
          totals: sumMoney(members, moneyFields),
        };
      })
    : [];

  const optionsByField: Record<string, string[]> = {};
  for (const [key, def] of Object.entries(fields)) {
    if (def.type !== "select" && def.type !== "person") continue;
    if (def.options) {
      optionsByField[key] = [...def.options];
      continue;
    }
    const seen = new Set<string>();
    for (const row of rows) {
      for (const value of valueKeys(row.values[key])) seen.add(value);
    }
    optionsByField[key] = [...seen]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .slice(0, OPTIONS_MAX);
  }

  const limit = Math.max(1, options.limit ?? config.limit);
  const start = Math.max(0, options.cursor ?? 0);
  const page = sorted.slice(start, start + limit);
  const next = start + limit;

  return {
    source: descriptor.id,
    rows: page,
    total: matched.length,
    scanned: options.scanned ?? rows.length,
    truncated: options.truncated ?? false,
    nextCursor: next < sorted.length ? String(next) : null,
    groups,
    totals: sumMoney(matched, moneyFields),
    options: optionsByField,
  };
}

/** Today in UTC as `YYYY-MM-DD`. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
