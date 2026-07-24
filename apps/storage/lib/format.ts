const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const exponent = Math.max(
    0,
    Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      BYTE_UNITS.length - 1,
    ),
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[exponent]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(deltaSeconds);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return rtf.format(deltaSeconds, "second");
  if (abs < 3600) return rtf.format(Math.round(deltaSeconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(deltaSeconds / 3600), "hour");
  if (abs < 30 * 86_400)
    return rtf.format(Math.round(deltaSeconds / 86_400), "day");
  return formatDateTime(iso);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function pluralize(count: number, singular: string, plural?: string) {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

// The API snake-cases every name it stores, so a rename field that echoes the
// raw input would promise something the server will not honour.
export function normalizeNamePreview(name: string): string {
  return name
    .replace(/[\s-]+/g, "_")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function normalizeFileNamePreview(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return normalizeNamePreview(name);
  return `${normalizeNamePreview(name.slice(0, dotIndex))}.${name
    .slice(dotIndex + 1)
    .toLowerCase()}`;
}
