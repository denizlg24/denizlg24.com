export type ApnsOutcome =
  | "sent"
  /** The token will never work again; stop sending to it. */
  | "disable"
  /** Our provider token was refused; mint a new one before the next send. */
  | "refresh-token"
  | "failed";

const DEAD_TOKEN_REASONS = new Set([
  "BadDeviceToken",
  "Unregistered",
  "DeviceTokenNotForTopic",
]);

const PROVIDER_TOKEN_REASONS = new Set([
  "ExpiredProviderToken",
  "InvalidProviderToken",
]);

export function classifyApnsResponse(
  status: number,
  reason: string | null,
): ApnsOutcome {
  if (status === 200) return "sent";
  if (status === 410) return "disable";
  if (reason && DEAD_TOKEN_REASONS.has(reason)) return "disable";
  if (status === 403 && reason && PROVIDER_TOKEN_REASONS.has(reason)) {
    return "refresh-token";
  }
  return "failed";
}

export function readApnsReason(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed &&
      typeof parsed === "object" &&
      "reason" in parsed &&
      typeof parsed.reason === "string"
    ) {
      return parsed.reason;
    }
  } catch {}
  return null;
}
