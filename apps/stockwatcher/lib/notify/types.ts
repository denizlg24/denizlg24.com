import type { ChannelKind } from "../models";

export type Channel = {
  id: string;
  kind: ChannelKind;
  label: string;
  /** Masked destination, safe to display. */
  target: string;
  status: "active" | "error";
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type ChannelsResponse = {
  channels: Channel[];
  email: { ready: boolean; address: string | null };
  /** One-click connections whose app credentials are configured. */
  connect: { telegram: boolean; discord: boolean; slack: boolean };
  /** VAPID public key for browser push, or null when push is off. */
  push: { publicKey: string | null };
  demo: boolean;
};

export type Tone = "up" | "down" | "info";

export type Detail = { label: string; value: string; tone?: Tone };

export type Range = { low: number; high: number };

/** One price alert that fired, with every figure a reader needs to act on it. */
export type Trigger = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  /** Change against the previous close. */
  day: { change: number; percent: number; previous: number } | null;
  /** Change since the alert was saved; set for move alerts. */
  since: { change: number; percent: number; reference: number } | null;
  dayRange: Range | null;
  yearRange: Range | null;
  volume: number | null;
  /** Compact rule, e.g. "Price ≥ 250". */
  rule: string;
  /** The rule in words, e.g. "Price rose to 250.00 or above". */
  ruleText: string;
  /** The metric's current value, formatted in its own units. */
  reading: string;
  threshold: string;
  /** How far the reading went through the threshold, e.g. "0.56% past 250.00". */
  beyond: string | null;
  note: string | null;
  repeat: "once" | "rearm";
  /** ISO time of the market data the check used. */
  quotedAt: string;
  source: string;
  url: string;
  tone: Tone;
};

export type Message = {
  /** Short uppercase label above the headline: "Price alert", "Signal", "Test message". */
  kicker: string;
  /** Subject line and notification title. */
  title: string;
  /** One sentence that stands alone in a push banner or inbox preview. */
  summary: string;
  tone: Tone;
  /** ISO time the event happened. */
  time: string;
  url: string;
  action: string;
  triggers: Trigger[];
  details: Detail[];
  body: string | null;
  /** Why the reader got this, shown in the footer. */
  reason: string;
  manageUrl: string | null;
};
