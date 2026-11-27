import { describeRule, reading } from "../alerts";
import type { AlertRule, Quote, Routine, Signal } from "../models";
import type { Detail, Message, Tone, Trigger } from "./types";

export const appUrl = (hash = "") =>
  `${(process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "")}/${hash}`;

const fixed = (digits: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const twoDp = fixed(2);
const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const pad = (value: number) => String(value).padStart(2, "0");

const minus = "−";

export const price = (value: number) =>
  Math.abs(value) >= 1 || value === 0
    ? twoDp.format(value).replace("-", minus)
    : Number(value.toPrecision(4)).toString().replace("-", minus);

export const signed = (value: number, format: (n: number) => string = price) =>
  `${value > 0 ? "+" : value < 0 ? minus : ""}${format(Math.abs(value))}`;

export const signedPercent = (value: number) =>
  `${signed(value, (n) => twoDp.format(n))}%`;

export const compact = (value: number) => compactFormat.format(value);

/** "27 Nov 2026, 14:32 UTC". Users span time zones, so times are always stated in UTC. */
export function utc(iso: string) {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

export const toneOf = (value: number | null | undefined): Tone =>
  value == null || value === 0 ? "info" : value > 0 ? "up" : "down";

export const arrow = (tone: Tone) =>
  tone === "up" ? "▲" : tone === "down" ? "▼" : "•";

const spell = (metric: AlertRule["metric"], value: number) =>
  metric === "change" || metric === "move"
    ? signedPercent(value)
    : metric === "volume"
      ? compact(value)
      : price(value);

function ruleText(rule: AlertRule, currency: string) {
  const up = rule.direction === "above";
  const target = spell(rule.metric, rule.target);
  const moved = up ? "rose to" : "fell to";
  const bound = up ? "higher" : "lower";
  switch (rule.metric) {
    case "price":
      return `Price ${moved} ${target} ${currency} or ${up ? "above" : "below"}`;
    case "change":
      return `Day change ${moved} ${target} or ${bound}`;
    case "move":
      return `Move since the alert was set ${moved} ${target} or ${bound}, measured from ${price(rule.reference ?? 0)} ${currency}`;
    case "volume":
      return up
        ? `Volume reached ${target} shares`
        : `Volume is at or below ${target} shares`;
  }
}

function beyond(rule: AlertRule, value: number) {
  const target = spell(rule.metric, rule.target);
  if (rule.metric === "price" || rule.metric === "volume") {
    if (!rule.target) return null;
    const share = Math.abs((value / rule.target - 1) * 100);
    const side = value >= rule.target ? "above" : "below";
    return `${twoDp.format(share)}% ${side} ${target}`;
  }
  const points = Math.abs(value - rule.target);
  return `${twoDp.format(points)} pts ${value >= rule.target ? "above" : "below"} ${target}`;
}

const range = (low: number | null, high: number | null) =>
  low != null && high != null && high >= low ? { low, high } : null;

/** Everything about one fired alert, read off the quote the monitor used. */
export function alertTrigger(
  rule: AlertRule,
  quote: Quote,
  source: string,
): Trigger {
  const value = reading(rule, quote);
  const day =
    quote.change != null && quote.percent != null && quote.previous != null
      ? {
          change: quote.change,
          percent: quote.percent,
          previous: quote.previous,
        }
      : null;
  const since =
    rule.reference != null && rule.reference > 0
      ? {
          change: quote.price - rule.reference,
          percent: (quote.price / rule.reference - 1) * 100,
          reference: rule.reference,
        }
      : null;
  return {
    symbol: rule.symbol,
    name: quote.name || rule.symbol,
    exchange: quote.exchange,
    currency: quote.currency,
    price: quote.price,
    day,
    since: rule.metric === "move" ? since : null,
    dayRange: range(quote.low, quote.high),
    yearRange: range(quote.yearLow, quote.yearHigh),
    volume: quote.volume,
    rule: describeRule(rule),
    ruleText: ruleText(rule, quote.currency),
    reading: value == null ? "—" : spell(rule.metric, value),
    threshold:
      rule.metric === "price"
        ? `${spell("price", rule.target)} ${quote.currency}`
        : spell(rule.metric, rule.target),
    beyond: value == null ? null : beyond(rule, value),
    note: rule.note || null,
    repeat: rule.repeat,
    quotedAt: new Date(quote.time * 1000).toISOString(),
    source,
    url: appUrl(`#security?ticker=${encodeURIComponent(rule.symbol)}&fn=GP`),
    tone:
      rule.metric === "volume"
        ? "info"
        : rule.direction === "above"
          ? "up"
          : "down",
  };
}

/** The labelled figures every channel shows for a trigger, in reading order. */
export function triggerRows(trigger: Trigger): Detail[] {
  const rows: Detail[] = [];
  if (trigger.day)
    rows.push(
      {
        label: "Day change",
        value: `${signed(trigger.day.change)} (${signedPercent(trigger.day.percent)})`,
        tone: toneOf(trigger.day.change),
      },
      { label: "Previous close", value: price(trigger.day.previous) },
    );
  if (trigger.since)
    rows.push({
      label: "Since alert was set",
      value: `${signed(trigger.since.change)} (${signedPercent(trigger.since.percent)}) from ${price(trigger.since.reference)}`,
      tone: toneOf(trigger.since.change),
    });
  rows.push({ label: "Threshold", value: trigger.threshold });
  if (trigger.beyond) rows.push({ label: "Crossed by", value: trigger.beyond });
  if (trigger.dayRange)
    rows.push({
      label: "Day range",
      value: `${price(trigger.dayRange.low)} – ${price(trigger.dayRange.high)}`,
    });
  if (trigger.yearRange)
    rows.push({
      label: "52-week range",
      value: `${price(trigger.yearRange.low)} – ${price(trigger.yearRange.high)}`,
    });
  if (trigger.volume != null)
    rows.push({ label: "Volume", value: compact(trigger.volume) });
  rows.push({
    label: "Market data",
    value: `${utc(trigger.quotedAt)} · ${trigger.source}`,
  });
  return rows;
}

export const repeatText = (trigger: Trigger) =>
  trigger.repeat === "once"
    ? "This alert fires once and is now switched off."
    : "This alert re-arms once the condition clears, and fires again on the next crossing.";

const headline = (trigger: Trigger) =>
  `${trigger.name} is at ${price(trigger.price)} ${trigger.currency}${trigger.day ? `, ${signedPercent(trigger.day.percent)} today` : ""}.`;

const listSymbols = (triggers: Trigger[]) =>
  triggers.length > 4
    ? `${triggers
        .slice(0, 3)
        .map((item) => item.symbol)
        .join(", ")} and ${triggers.length - 3} more`
    : new Intl.ListFormat("en", { type: "conjunction" }).format(
        triggers.map((item) => item.symbol),
      );

/** One message for every alert that fired together for the same destination. */
export function alertMessage(triggers: Trigger[], time: string): Message {
  const [first] = triggers;
  if (!first) throw new Error("An alert message needs at least one trigger.");
  const single = triggers.length === 1;
  const tones = new Set(triggers.map((item) => item.tone));
  return {
    kicker: single ? "Price alert" : `${triggers.length} price alerts`,
    title: single
      ? `${first.symbol} ${price(first.price)} ${first.currency} · ${first.rule}`
      : `${triggers.length} alerts: ${listSymbols(triggers)}`,
    summary: single
      ? `${headline(first)} ${first.ruleText}.`
      : `${listSymbols(triggers)} crossed their alert thresholds in the same check.`,
    tone: tones.size === 1 ? first.tone : "info",
    time,
    url: single ? first.url : appUrl("#alerts"),
    action: single ? `Open ${first.symbol} chart` : "Open alerts",
    triggers,
    details: [],
    body: null,
    reason: single
      ? "You set this alert in Stockwatcher and chose to send it here."
      : "You set these alerts in Stockwatcher and chose to send them here. Alerts that fire in the same check arrive together.",
    manageUrl: appUrl("#alerts"),
  };
}

export function signalMessage(
  signal: Signal,
  kind: "fired" | "disabled",
  time: string,
  maxErrors: number,
): Message {
  const shared = {
    time,
    url: appUrl("#alerts"),
    action: "Open alerts",
    triggers: [],
    reason: "You saved this signal in Stockwatcher and chose to send it here.",
    manageUrl: appUrl("#alerts"),
  } satisfies Partial<Message>;
  if (kind === "disabled")
    return {
      ...shared,
      kicker: "Signal switched off",
      title: `${signal.name} · signal switched off`,
      summary: `The signal “${signal.name}” failed ${maxErrors} checks in a row, so Stockwatcher turned it off.`,
      tone: "info",
      details: [
        { label: "Last error", value: signal.lastError ?? "Unknown" },
        ...(signal.lastChecked
          ? [{ label: "Last checked", value: utc(signal.lastChecked) }]
          : []),
      ],
      body: "Ask the assistant to fix the script, then switch the signal back on under Alerts.",
    };
  const details: Detail[] = [];
  if (signal.lastValue != null)
    details.push({ label: "Value", value: String(signal.lastValue) });
  details.push({
    label: "Checked",
    value: `${signal.cadence === "tick" ? "Every two minutes" : signal.cadence === "hourly" ? "Hourly" : "Daily"}`,
  });
  details.push({ label: "Times fired", value: String(signal.triggerCount) });
  return {
    ...shared,
    kicker: "Signal",
    title: `${signal.name} · signal fired`,
    summary: signal.lastMessage ?? `The signal “${signal.name}” returned true.`,
    tone: "info",
    details,
    body:
      [
        signal.note ? `Note: ${signal.note}` : null,
        signal.repeat === "rearm"
          ? "This signal re-arms once it returns false."
          : "This signal fires once and is now switched off.",
      ]
        .filter(Boolean)
        .join("\n") || null,
  };
}

const routineBodyLimit = 1_800;

/** The headline of a markdown reply: its first line of prose, without markup. */
export function replyHeadline(reply: string) {
  const line =
    reply
      .split("\n")
      .map((text) =>
        text
          .replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)/, "")
          .replace(/[*_`]/g, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .trim(),
      )
      .find((text) => text.length > 0 && !/^\|?[-:| ]+\|?$/.test(text)) ?? "";
  return line.length > 240 ? `${line.slice(0, 239)}…` : line;
}

export function routineMessage(
  routine: Routine,
  outcome:
    | { ok: true; reply: string; threadId: string; credits: number | null }
    | { ok: false; error: string },
  time: string,
  schedule: string,
): Message {
  if (!outcome.ok)
    return {
      kicker: "Routine failed",
      title: `${routine.name} · did not run`,
      summary: `The routine “${routine.name}” could not run: ${outcome.error}`,
      tone: "info",
      time,
      url: appUrl("#alerts"),
      action: "Open alerts",
      triggers: [],
      details: [{ label: "Schedule", value: schedule }],
      body: "It will try again at its next scheduled time.",
      reason:
        "You saved this routine in Stockwatcher and chose to send it here.",
      manageUrl: appUrl("#alerts"),
    };
  const clipped =
    outcome.reply.length > routineBodyLimit
      ? `${outcome.reply.slice(0, routineBodyLimit - 1).trimEnd()}…\n\nThe full answer is in the thread.`
      : outcome.reply;
  return {
    kicker: "Routine",
    title: routine.name,
    summary:
      replyHeadline(outcome.reply) ||
      `The routine “${routine.name}” ran and saved its answer as a thread.`,
    tone: "info",
    time,
    url: appUrl(`?thread=${encodeURIComponent(outcome.threadId)}`),
    action: "Open the full answer",
    triggers: [],
    details: [
      { label: "Schedule", value: schedule },
      ...(outcome.credits != null
        ? [{ label: "Credits used", value: outcome.credits.toFixed(1) }]
        : []),
    ],
    body: clipped,
    reason: "You saved this routine in Stockwatcher and chose to send it here.",
    manageUrl: appUrl("#alerts"),
  };
}

/** A real-looking alert with example figures, so a test shows what alerts will look like. */
export function testMessage(label: string, now = new Date()): Message {
  const time = now.toISOString();
  const example: Trigger = {
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NasdaqGS",
    currency: "USD",
    price: 251.4,
    day: { change: 3.12, percent: 1.26, previous: 248.28 },
    since: null,
    dayRange: { low: 246.1, high: 252.05 },
    yearRange: { low: 169.21, high: 260.1 },
    volume: 48_210_000,
    rule: "Price ≥ 250",
    ruleText: "Price rose to 250.00 USD or above",
    reading: "251.40",
    threshold: "250.00 USD",
    beyond: "0.56% above 250.00",
    note: "Example alert. These are not live prices.",
    repeat: "once",
    quotedAt: time,
    source: "Example data",
    url: appUrl("#alerts"),
    tone: "up",
  };
  return {
    ...alertMessage([example], time),
    kicker: "Test message",
    title: `Stockwatcher test: ${label} is connected`,
    summary: `${label} is connected. Price alerts you route here will arrive like the example below.`,
    action: "Open alerts",
    reason: `You connected ${label} to Stockwatcher and asked for a test message.`,
  };
}
