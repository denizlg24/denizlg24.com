import { describe, expect, test } from "bun:test";
import type { AlertRule, Quote } from "../models";
import { alertMessage, alertTrigger, testMessage } from "./compose";
import {
  discordPayload,
  emailHtml,
  emailText,
  pushPayload,
  slackPayload,
  telegramHtml,
  webhookPayload,
} from "./render";

const rule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
  id: "6d0f1d8e-6a52-4d6c-9a43-2b8d3c1d6f10",
  symbol: "AAPL",
  metric: "price",
  direction: "above",
  target: 250,
  reference: 240,
  repeat: "once",
  primed: true,
  enabled: true,
  note: "Trim <half> & review",
  channels: [],
  expires: null,
  lastTriggered: null,
  triggeredPrice: null,
  triggerCount: 0,
  ...overrides,
});

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  symbol: "AAPL",
  name: "Apple Inc.",
  currency: "USD",
  exchange: "NasdaqGS",
  price: 251.4,
  previous: 248.28,
  change: 3.12,
  percent: 1.2566,
  time: Date.UTC(2026, 10, 27, 14, 30) / 1000,
  open: 248.5,
  high: 252.05,
  low: 246.1,
  yearHigh: 260.1,
  yearLow: 169.21,
  volume: 48_210_000,
  cap: null,
  ...overrides,
});

const time = "2026-11-27T14:32:00.000Z";

describe("alertTrigger", () => {
  test("states the rule in words and how far the price went through it", () => {
    const trigger = alertTrigger(rule(), quote(), "Yahoo Finance");
    expect(trigger.ruleText).toBe("Price rose to 250.00 USD or above");
    expect(trigger.beyond).toBe("0.56% above 250.00");
    expect(trigger.day?.percent).toBeCloseTo(1.2566);
    expect(trigger.since).toBeNull();
    expect(trigger.quotedAt).toBe("2026-11-27T14:30:00.000Z");
    expect(trigger.url).toEndWith("#security?ticker=AAPL&fn=GP");
  });

  test("measures move alerts from the reference price", () => {
    const trigger = alertTrigger(
      rule({ metric: "move", direction: "below", target: -5, reference: 270 }),
      quote(),
      "Yahoo Finance",
    );
    expect(trigger.tone).toBe("down");
    expect(trigger.since?.reference).toBe(270);
    expect(trigger.since?.percent).toBeCloseTo(-6.89, 1);
    expect(trigger.ruleText).toContain("measured from 270.00 USD");
    expect(trigger.beyond).toMatch(/pts below −5\.00%$/);
  });

  test("leaves day figures out when the quote has no previous close", () => {
    const trigger = alertTrigger(
      rule(),
      quote({ previous: null, change: null, percent: null, high: null }),
      "Yahoo Finance",
    );
    expect(trigger.day).toBeNull();
    expect(trigger.dayRange).toBeNull();
  });
});

describe("rendering", () => {
  const one = alertMessage(
    [alertTrigger(rule(), quote(), "Yahoo Finance")],
    time,
  );
  const many = alertMessage(
    [
      alertTrigger(rule(), quote(), "Yahoo Finance"),
      alertTrigger(
        rule({ symbol: "SAP.DE", direction: "below", target: 200 }),
        quote({
          symbol: "SAP.DE",
          name: "SAP SE",
          currency: "EUR",
          price: 198,
        }),
        "Yahoo Finance",
      ),
    ],
    time,
  );

  test("a single alert links to its chart, a batch to the alerts page", () => {
    expect(one.title).toBe("AAPL 251.40 USD · Price ≥ 250");
    expect(one.url).toContain("#security?ticker=AAPL");
    expect(many.title).toBe("2 alerts: AAPL and SAP.DE");
    expect(many.url).toEndWith("#alerts");
    expect(many.tone).toBe("info");
  });

  test("email escapes user text and carries the figures and footer", () => {
    const html = emailHtml(one, "https://example.com/apple-icon.png");
    expect(html).toContain("Trim &lt;half&gt; &amp; review");
    expect(html).not.toContain("<half>");
    expect(html).toContain("52-week range");
    expect(html).toContain("27 Nov 2026, 14:32 UTC");
    expect(html).toContain("You set this alert in Stockwatcher");
    expect(html).toContain("prefers-color-scheme:dark");
    const text = emailText(one);
    expect(text).toContain("Price rose to 250.00 USD or above.");
    expect(text).toContain("Open AAPL chart: ");
  });

  test("each batched alert appears once in every channel format", () => {
    const html = emailHtml(many, null);
    expect(html.match(/Open SAP\.DE chart/g)?.length).toBe(1);
    expect(discordPayload(many).embeds).toHaveLength(2);
    expect(telegramHtml(many)).toContain("<b>SAP.DE  198.00 EUR</b>");
    expect(
      slackPayload(many).blocks.filter((block) => block.type === "divider"),
    ).toHaveLength(2);
    expect(pushPayload(many).body.split("\n")).toHaveLength(2);
  });

  test("telegram HTML escapes notes and stays under the message limit", () => {
    const html = telegramHtml(one);
    expect(html).toContain("<blockquote>Trim &lt;half&gt; &amp; review");
    expect(html.length).toBeLessThan(4096);
  });

  test("the webhook keeps its original fields", () => {
    const payload = webhookPayload(one, time);
    expect(payload).toMatchObject({
      event: "stockwatcher.alert",
      title: one.title,
      url: one.url,
      tone: "up",
    });
    expect(payload.data.Symbol).toBe("AAPL");
    expect(payload.triggers).toHaveLength(1);
  });

  test("the test message shows an example alert", () => {
    const message = testMessage("Telegram", new Date(time));
    expect(message.kicker).toBe("Test message");
    expect(message.triggers[0]?.note).toContain("not live prices");
  });
});
