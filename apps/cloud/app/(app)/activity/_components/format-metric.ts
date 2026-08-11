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
    case "seconds":
      return formatDuration(value);
    case "milliseconds":
      return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
    case "megahertz":
      return value >= 1_000
        ? `${(value / 1_000).toFixed(2)} GHz`
        : `${value.toFixed(0)} MHz`;
    case "rpm":
      return `${value.toFixed(0)} rpm`;
    case "volts":
      return `${value.toFixed(3)} V`;
    case "watts":
      return `${value.toFixed(1)} W`;
    case "amps":
      return `${value.toFixed(2)} A`;
  }
}

function formatDuration(value: number): string {
  const total = Math.floor(Math.abs(value));
  const sign = value < 0 ? "-" : "";
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${minutes}m`;
  if (minutes > 0) return `${sign}${minutes}m ${seconds}s`;
  return `${sign}${seconds}s`;
}
