import { formatBytes } from "@repo/cloud-ui/format";
import type { AlertRuleUnit } from "@repo/schemas/cloud";

/** Mirrors `formatMetricValue` in cloud-core, for values rendered client-side. */
export function formatValue(value: number, unit: AlertRuleUnit): string {
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
      return Number.isInteger(value)
        ? value.toLocaleString()
        : value.toFixed(1);
  }
}
