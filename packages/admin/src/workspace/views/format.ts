import type {
  ViewFieldDef,
  ViewMoney,
  ViewTotal,
  ViewValue,
} from "@repo/schemas";
import { isMoney, valueKeys } from "@repo/utils/workspace-views";
import { format, parseISO } from "date-fns";

export function formatMoney({ amountMinor, currency }: ViewMoney): string {
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** digits);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

/** Per-currency totals of one field, each in its own currency. */
export function formatTotals(
  totals: readonly ViewTotal[],
  field: string,
): string[] {
  return totals
    .filter((total) => total.field === field)
    .map((total) =>
      formatMoney({ amountMinor: total.amountMinor, currency: total.currency }),
    );
}

export function formatDateValue(value: string): string {
  try {
    const date = parseISO(value);
    if (Number.isNaN(date.getTime())) return value;
    if (value.length <= 10) return format(date, "MMM d, yyyy");
    return format(date, "MMM d, yyyy HH:mm");
  } catch {
    return value;
  }
}

/** A cell as text: dates local, money in the row's own currency, lists joined. */
export function formatValue(
  def: ViewFieldDef | undefined,
  value: ViewValue | undefined,
): string {
  if (value === null || value === undefined) return "";
  if (isMoney(value)) return formatMoney(value);
  if (typeof value === "boolean") return value ? "✓" : "";
  if (typeof value === "number") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof value === "string") {
    return def?.type === "date" ? formatDateValue(value) : value;
  }
  return valueKeys(value).join(", ");
}

/** A group heading's text: "" is the rows with no value. */
export function groupLabel(def: ViewFieldDef | undefined, key: string): string {
  if (key === "") return "—";
  if (def?.type === "boolean") return key === "true" ? "Yes" : "No";
  return key;
}
