import "server-only";
import { alertWorkspaces } from "./db";
import { channelsFor, deliverTo, persist } from "./alert-delivery";
import { monitorSignals } from "./signal-monitor";
import { quotes } from "./market";
import {
  conditionMet,
  describeRule,
  expired,
  formatTarget,
  reading,
} from "./alerts";
import type { AlertEvent, AlertRule, Quote, Workspace } from "./models";
import type { Message } from "./notify/send";
import { appUrl } from "./notify/channel-api";
import { amount, percent } from "./utils";

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

function message({ rule, quote }: Fired): Message {
  const value = reading(rule, quote);
  const rising = rule.direction === "above";
  const lines = [
    `${quote.name || rule.symbol} is at ${amount(quote.price)} ${quote.currency}${quote.percent != null ? ` (${percent(quote.percent)} today)` : ""}.`,
    `Rule: ${describeRule(rule)}${value != null && rule.metric !== "price" ? ` · now ${formatTarget(rule.metric, value)}` : ""}.`,
  ];
  if (rule.note) lines.push(`Note: ${rule.note}`);
  if (rule.repeat === "rearm")
    lines.push("This alert re-arms once the condition clears.");
  return {
    title: `${rule.symbol} · ${describeRule(rule)}`,
    body: lines.join("\n"),
    url: appUrl(`#security?ticker=${encodeURIComponent(rule.symbol)}&fn=GP`),
    tone: rising ? "up" : "down",
    data: {
      Symbol: rule.symbol,
      Last: `${amount(quote.price)} ${quote.currency}`,
      "Day change": quote.percent != null ? percent(quote.percent) : null,
      Exchange: quote.exchange || null,
      Triggered: new Date().toUTCString(),
    },
  };
}

async function notify(userId: string, fired: Fired[]) {
  const channels = await channelsFor(
    userId,
    new Set(fired.flatMap(({ rule }) => rule.channels)),
  );
  const events = await Promise.all(
    fired.map(async (item): Promise<AlertEvent> => {
      const content = message(item);
      const deliveries = await deliverTo(
        userId,
        channels,
        item.rule.channels,
        content,
      );
      return {
        id: crypto.randomUUID(),
        alertId: item.rule.id,
        symbol: item.rule.symbol,
        label: "",
        time: item.rule.lastTriggered ?? new Date().toISOString(),
        price: item.quote.price,
        currency: item.quote.currency.slice(0, 8),
        message: content.body.slice(0, 400),
        deliveries,
      };
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
          notify(id, fired).catch(() =>
            console.error("Alert delivery failed"),
          ),
        );
    }
    await Promise.all(sending);
  } finally {
    running = false;
  }
}
