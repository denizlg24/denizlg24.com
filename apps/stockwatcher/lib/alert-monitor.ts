import "server-only";
import { channelsFor, deliverTo, persist } from "./alert-delivery";
import { conditionMet, expired, reading } from "./alerts";
import { alertWorkspaces } from "./db";
import { quotes } from "./market";
import type { AlertEvent, AlertRule, Quote, Workspace } from "./models";
import { isMoex } from "./moex";
import {
  alertMessage,
  alertTrigger,
  price,
  signedPercent,
} from "./notify/compose";
import type { Trigger } from "./notify/types";
import { monitorSignals } from "./signal-monitor";

let running = false;
const staleAfter = 96 * 60 * 60 * 1000;

type Fired = { rule: AlertRule; quote: Quote };

/** Advances every alert one tick. Pure apart from the quotes it is given, so a conflicted save can be replayed. */
export function evaluate(workspace: Workspace, data: Map<string, Quote>) {
  const fired: Fired[] = [];
  let changed = false;
  const now = new Date();
  for (const rule of workspace.alerts) {
    if (!rule.enabled) continue;
    if (expired(rule, now)) {
      rule.enabled = false;
      changed = true;
      continue;
    }
    const quote = data.get(rule.symbol);
    if (!quote || Date.now() - quote.time * 1000 > staleAfter) continue;
    const value = reading(rule, quote);
    if (value == null) continue;
    const met = conditionMet(rule, value);
    if (!rule.primed) {
      if (!met) {
        rule.primed = true;
        changed = true;
      }
      continue;
    }
    if (!met) continue;
    rule.lastTriggered = now.toISOString();
    rule.triggeredPrice = quote.price;
    rule.triggerCount += 1;
    if (rule.repeat === "once") rule.enabled = false;
    else rule.primed = false;
    fired.push({ rule: structuredClone(rule), quote });
    changed = true;
  }
  return { changed, fired };
}

const activityText = (trigger: Trigger) =>
  [
    `${trigger.name} is at ${price(trigger.price)} ${trigger.currency}${trigger.day ? ` (${signedPercent(trigger.day.percent)} today)` : ""}.`,
    `Rule: ${trigger.ruleText}${trigger.beyond ? ` · ${trigger.beyond}` : ""}.`,
    ...(trigger.note ? [`Note: ${trigger.note}`] : []),
  ]
    .join("\n")
    .slice(0, 400);

/**
 * Alerts that fire in the same check go out as one message per channel, so a
 * channel shared by three alerts gets one notification listing all three.
 */
async function notify(userId: string, fired: Fired[]) {
  const channels = await channelsFor(
    userId,
    new Set(fired.flatMap(({ rule }) => rule.channels)),
  );
  const time = new Date().toISOString();
  const items = fired.map(({ rule, quote }) => ({
    rule,
    quote,
    trigger: alertTrigger(
      rule,
      quote,
      isMoex(rule.symbol) ? "Moscow Exchange" : "Yahoo Finance",
    ),
  }));
  const results = (
    await Promise.all(
      channels.map((channel) => {
        const routed = items
          .filter(({ rule }) => rule.channels.includes(channel.id))
          .map(({ trigger }) => trigger);
        return routed.length
          ? deliverTo(
              userId,
              [channel],
              [channel.id],
              alertMessage(routed, time),
            )
          : [];
      }),
    )
  ).flat();
  const events = items.map(
    ({ rule, quote, trigger }): AlertEvent => ({
      id: crypto.randomUUID(),
      alertId: rule.id,
      symbol: rule.symbol,
      label: "",
      time: rule.lastTriggered ?? time,
      price: quote.price,
      currency: quote.currency.slice(0, 8),
      message: activityText(trigger),
      deliveries: results.filter((result) =>
        rule.channels.includes(result.channel),
      ),
    }),
  );
  await persist(userId, (workspace) => {
    workspace.alertLog = [...events, ...workspace.alertLog].slice(0, 120);
    return true;
  });
}

export async function monitorAlerts() {
  if (running) return;
  running = true;
  try {
    const workspaces = await alertWorkspaces();
    void monitorSignals(workspaces).catch(() =>
      console.error("Signal check failed"),
    );
    const symbols = [
      ...new Set(
        workspaces.flatMap(({ data }) =>
          data.alerts.filter((item) => item.enabled).map((item) => item.symbol),
        ),
      ),
    ];
    if (!symbols.length) return;
    const data = new Map(
      (await quotes(symbols)).map((item) => [item.symbol, item]),
    );
    const sending: Promise<void>[] = [];
    for (const { id } of workspaces) {
      let fired: Fired[] = [];
      // Persist before sending so a crash or conflict can never deliver twice.
      const saved = await persist(id, (workspace) => {
        const result = evaluate(workspace, data);
        fired = result.fired;
        return result.changed;
      });
      if (saved && fired.length)
        sending.push(
          notify(id, fired).catch(() => console.error("Alert delivery failed")),
        );
    }
    await Promise.all(sending);
  } finally {
    running = false;
  }
}
