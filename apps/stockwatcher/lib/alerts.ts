import type { AlertMetric, AlertRule, ChannelKind, Quote } from "./models";

export const metricLabels: Record<AlertMetric, string> = {
  price: "Price",
  change: "Day change",
  move: "Move since set",
  volume: "Volume",
};

export const metricHints: Record<AlertMetric, string> = {
  price: "Last traded price in the listing’s quote currency.",
  change: "Percent change against the previous close.",
  move: "Percent move from the price when the alert was saved.",
  volume: "Shares traded so far in the session.",
};

export const channelLabels: Record<ChannelKind, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  ntfy: "Phone push (ntfy)",
  push: "Browser push",
  webhook: "Webhook",
};

type Reading = Pick<Quote, "price" | "percent" | "volume">;

/** The value an alert compares against its target, or null when unknown. */
export function reading(
  rule: Pick<AlertRule, "metric" | "reference">,
  quote: Reading | undefined,
): number | null {
  if (!quote) return null;
  switch (rule.metric) {
    case "price":
      return quote.price;
    case "change":
      return quote.percent;
    case "move":
      return rule.reference ? (quote.price / rule.reference - 1) * 100 : null;
    case "volume":
      return quote.volume;
  }
}

export function conditionMet(
  rule: Pick<AlertRule, "direction" | "target">,
  value: number,
) {
  return rule.direction === "above"
    ? value >= rule.target
    : value <= rule.target;
}

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

export function formatTarget(metric: AlertMetric, value: number) {
  if (metric === "change" || metric === "move")
    return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  if (metric === "volume") return compact.format(value);
  return plain.format(value);
}

export function describeRule(
  rule: Pick<AlertRule, "metric" | "direction" | "target" | "reference">,
) {
  const sign = rule.direction === "above" ? "≥" : "≤";
  const target = formatTarget(rule.metric, rule.target);
  switch (rule.metric) {
    case "price":
      return `Price ${sign} ${target}`;
    case "change":
      return `Day change ${sign} ${target}`;
    case "move":
      return `Move ${sign} ${target} from ${plain.format(rule.reference ?? 0)}`;
    case "volume":
      return `Volume ${sign} ${target}`;
  }
}

/** Distance from the current reading to the target, in the metric's units. */
export function gap(rule: AlertRule, quote: Reading | undefined) {
  const value = reading(rule, quote);
  if (value == null) return null;
  if (rule.metric === "price" || rule.metric === "volume")
    return value ? (rule.target / value - 1) * 100 : null;
  return rule.target - value;
}

export function expired(rule: Pick<AlertRule, "expires">, now = new Date()) {
  return rule.expires != null && rule.expires < now.toISOString().slice(0, 10);
}

/** Rounds a price picked off a chart or preset to a precision a trader would type. */
export function tidyPrice(price: number) {
  if (price >= 1) return Math.round(price * 100) / 100;
  return Number(price.toPrecision(4));
}
