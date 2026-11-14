import type { ViewValue } from "@repo/schemas";

export function viewValueText(value: ViewValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value
      .map((item) => (typeof item === "string" ? item : item.name))
      .join(", ");
  if (typeof value === "object")
    return `${(value.amountMinor / 100).toFixed(2)} ${value.currency}`;
  return String(value);
}
