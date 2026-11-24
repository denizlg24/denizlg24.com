import "server-only";
import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { attempt, round, ticker } from "./shared";
import {
  conditionMet,
  describeRule,
  expired,
  gap,
  reading,
} from "@/lib/alerts";
import { toolLabels, toolPoints } from "@/lib/chart-studio";
import { defaultDesk } from "@/lib/desk";
import { readWorkspace, type Identity } from "@/lib/db";
import { updateWorkspace } from "@/lib/memory";
import { quotes } from "@/lib/market";
import {
  alertMetrics,
  averageKinds,
  chartAppearanceSchema,
  chartColorSchema,
  chartScales,
  chartStyles,
  customAverageSchema,
  customPaneSchema,
  chartPreferencesSchema,
  drawingKinds,
  relationNoteSchema,
  type AlertRule,
  type Workspace,
} from "@/lib/models";
import { listChannels, publicChannel } from "@/lib/notify/store";
import { decodeOverlay, overlayRanges } from "@/lib/overlay";
import { checkTrades } from "@/lib/portfolio";
import { lookbackKeys, screenSchema } from "@/lib/screens";
import { studyKeySchema } from "@/lib/indicators";
import { rangeKeys } from "@/lib/universes";

type Outcome = { workspaceChanged: true; summary: string; [key: string]: unknown };

const changed = (summary: string, details: object): Outcome => ({
  workspaceChanged: true,
  summary,
  ...details,
});

function need<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

function pick<T extends { id: string; name: string }>(
  items: T[],
  ref: string | undefined,
  label: string,
): T {
  const needle = need(ref, `Provide the ${label} id or name.`);
  const byId = items.find((item) => item.id === needle);
  if (byId) return byId;
  const named = items.filter(
    (item) => item.name.toLowerCase() === needle.trim().toLowerCase(),
  );
  if (named.length === 1) return named[0];
  throw new Error(
    named.length
      ? `Several ${label}s are named "${needle}"; use the id.`
      : `No ${label} matches "${needle}". Call getWorkspace for the ids.`,
  );
}

function pickById<T extends { id: string }>(
  items: T[],
  id: string | undefined,
  label: string,
): T {
  const found = items.find((item) => item.id === need(id, `Provide the ${label} id.`));
  if (!found) throw new Error(`No ${label} with id ${id}. Call getWorkspace for the ids.`);
  return found;
}

function missingIds(items: { id: string }[], ids: string[]) {
  const known = new Set(items.map((item) => item.id));
  return ids.filter((id) => !known.has(id));
}

/** Applies a validated, optimistic-concurrency workspace change and returns what the change reports. */
async function write(
  userId: string,
  change: (workspace: Workspace) => [Workspace, Outcome],
): Promise<Outcome> {
  const outcome: Outcome[] = [];
  try {
    await updateWorkspace(userId, (workspace) => {
      const [next, value] = change(workspace);
      outcome.length = 0;
      outcome.push(value);
      return next;
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new Error(
        error.issues
          .slice(0, 2)
          .map((issue) =>
            [issue.path.join("."), issue.message].filter(Boolean).join(": "),
          )
          .join("; "),
      );
    throw error;
  }
  if (!outcome.length) throw new Error("The workspace could not be updated.");
  return outcome[0];
}

const readWorkspaceData = async (userId: string) =>
  (await readWorkspace(userId)).data;

const uuid = z.uuid();
const currencyCode = z.string().regex(/^[A-Z]{3}$|^GBp$|^ZAc$|^ILA$/);
const today = () => new Date().toISOString().slice(0, 10);

async function resolveChannels(userId: string, requested: string[] | undefined) {
  const all = (await listChannels(userId)).map(publicChannel);
  if (!requested)
    return all
      .filter((channel) => channel.status === "active")
      .slice(0, 10)
      .map((channel) => channel.id);
  return requested.map((ref) => {
    const needle = ref.trim().toLowerCase();
    const hit =
      all.find((channel) => channel.id === ref) ??
      all.find((channel) => channel.label.toLowerCase() === needle);
    if (!hit)
      throw new Error(
        `No notification channel "${ref}". Available: ${all.map((channel) => channel.label).join(", ") || "none"}.`,
      );
    return hit.id;
  });
}

const alertView = (rule: AlertRule, labels: Map<string, string>) => ({
  id: rule.id,
  symbol: rule.symbol,
  rule: describeRule(rule),
  metric: rule.metric,
  direction: rule.direction,
  target: rule.target,
  reference: rule.reference,
  repeat: rule.repeat,
  enabled: rule.enabled,
  note: rule.note,
  channels: rule.channels.map((id) => labels.get(id) ?? "(deleted channel)"),
  expires: rule.expires,
  lastTriggered: rule.lastTriggered,
  triggeredPrice: rule.triggeredPrice,
  triggerCount: rule.triggerCount,
});

const sameRule = (a: AlertRule, b: AlertRule) =>
  a.symbol === b.symbol &&
  a.metric === b.metric &&
  a.direction === b.direction &&
  a.target === b.target &&
  a.reference === b.reference;

const tradeInput = z.object({
  symbol: ticker,
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive().max(1e12),
  price: z.number().positive().max(1e12).describe("Per-unit price in the trade currency"),
  fees: z.number().min(0).max(1e12).default(0),
  currency: currencyCode
    .optional()
    .describe("ISO code (GBp/ZAc/ILA for pence-style listings). Defaults to the symbol's live quote currency"),
  date: z.iso.date().describe("Trade date YYYY-MM-DD"),
});

async function defaultCurrencies(symbols: string[]) {
  const found = await quotes([...new Set(symbols)]).catch(() => []);
  return new Map(found.map((quote) => [quote.symbol, quote.currency]));
}

const drawingPoint = z.object({
  t: z.number().int().describe("Unix seconds"),
  p: z.number().finite().describe("Price"),
});

const sections = [
  "watchlists",
  "books",
  "trades",
  "notes",
  "alerts",
  "alertActivity",
  "notificationChannels",
  "drawings",
  "overlays",
  "screens",
  "relations",
  "chartTemplates",
  "settings",
  "desk",
  "requests",
] as const;
type Section = (typeof sections)[number];
const defaultSections: Section[] = [
  "watchlists",
  "books",
  "notes",
  "alerts",
  "notificationChannels",
  "overlays",
  "screens",
  "chartTemplates",
  "settings",
  "desk",
];

export function workspaceTools({ user }: { user: Identity }) {
  const userId = user.id;
  return {
    getWorkspace: tool({
      description: `Read the user's saved workspace. Choose sections (default: ${defaultSections.join(", ")}). Heavy sections (trades, alertActivity, drawings, relations, requests) are only returned when asked. Every record includes the id needed for writes; counts of every section are always included. Alerts carry live reading, distance to target and status; notificationChannels are masked and never expose secrets. Notes list titles only; use getNote for a body.`,
      inputSchema: z.object({
        sections: z.array(z.enum(sections)).max(sections.length).optional(),
        book: z.string().max(120).optional().describe("Filter trades by portfolio id or name"),
        symbol: ticker.optional().describe("Filter trades, alerts, notes, drawings and relations by symbol"),
        from: z.iso.date().optional().describe("Trades on or after this date"),
        to: z.iso.date().optional().describe("Trades on or before this date"),
        limit: z.number().int().min(1).max(200).default(50).describe("Cap for trades, alert activity and relations"),
      }),
      execute: ({ sections: requested, book, symbol, from, to, limit }) =>
        attempt(async () => {
          const data = await readWorkspaceData(userId);
          const wanted = new Set<Section>(requested ?? defaultSections);
          const out: Record<string, unknown> = {
            counts: {
              watchlists: data.watchlists.length,
              books: data.books.length,
              trades: data.trades.length,
              notes: data.notes.length,
              alerts: data.alerts.length,
              alertActivity: data.alertLog.length,
              drawings: data.drawings.length,
              overlays: data.overlays.length,
              screens: data.screens.length,
              relations: data.relations.length,
              chartTemplates: data.chartTemplates.length,
              requests: data.requests.length,
            },
          };
          if (wanted.has("watchlists"))
            out.watchlists = data.watchlists.map((list) => ({
              id: list.id,
              name: list.name,
              symbols: list.symbols,
            }));
          if (wanted.has("books"))
            out.books = data.books.map((item) => ({
              id: item.id,
              name: item.name,
              trades: data.trades.filter((trade) => trade.bookId === item.id).length,
              brokerSynced: item.broker != null,
              broker: item.broker && {
                provider: item.broker.provider,
                account: item.broker.account,
                asOf: item.broker.asOf,
                syncedAt: item.broker.syncedAt,
                cash: item.broker.cash,
              },
            }));
          if (wanted.has("trades")) {
            const bookId = book ? pick(data.books, book, "portfolio").id : undefined;
            const names = new Map(data.books.map((item) => [item.id, item.name]));
            const matches = data.trades
              .filter(
                (trade) =>
                  (!bookId || trade.bookId === bookId) &&
                  (!symbol || trade.symbol === symbol) &&
                  (!from || trade.date >= from) &&
                  (!to || trade.date <= to),
              )
              .toSorted((a, b) => b.date.localeCompare(a.date));
            out.trades = {
              matched: matches.length,
              shown: Math.min(limit, matches.length),
              items: matches.slice(0, limit).map((trade) => ({
                ...trade,
                book: names.get(trade.bookId),
              })),
            };
          }
          if (wanted.has("notes"))
            out.notes = data.notes
              .filter((note) => !symbol || note.symbol === symbol)
              .map((note) => ({
                id: note.id,
                title: note.title,
                symbol: note.symbol,
                updatedAt: note.updatedAt,
                characters: note.body.length,
              }));
          const channels = (await listChannels(userId)).map(publicChannel);
          if (wanted.has("notificationChannels"))
            out.notificationChannels = channels;
          if (wanted.has("alerts")) {
            const rules = data.alerts.filter((rule) => !symbol || rule.symbol === symbol);
            const live = rules.length
              ? await quotes([...new Set(rules.map((rule) => rule.symbol))]).catch(() => [])
              : [];
            const bySymbol = new Map(live.map((quote) => [quote.symbol, quote]));
            const labels = new Map(channels.map((channel) => [channel.id, channel.label]));
            out.alerts = rules.map((rule) => {
              const quote = bySymbol.get(rule.symbol);
              const value = reading(rule, quote);
              const status = !rule.enabled
                ? "paused"
                : expired(rule)
                  ? "expired"
                  : !rule.primed
                    ? "fired, waiting for the condition to clear"
                    : value != null && conditionMet(rule, value)
                      ? "condition met, awaiting next check"
                      : "armed";
              return {
                ...alertView(rule, labels),
                status,
                primed: rule.primed,
                currentReading: round(value, 4),
                currency: quote?.currency ?? null,
                distanceToTarget: round(gap(rule, quote)),
                distanceUnit:
                  rule.metric === "change" || rule.metric === "move" ? "percentage points" : "percent of reading",
              };
            });
          }
          if (wanted.has("alertActivity"))
            out.alertActivity = data.alertLog
              .filter((event) => !symbol || event.symbol === symbol)
              .slice(0, limit)
              .map((event) => ({
                id: event.id,
                alertId: event.alertId,
                symbol: event.symbol,
                time: event.time,
                price: event.price,
                currency: event.currency,
                message: event.message,
                deliveries: event.deliveries.map((delivery) => ({
                  channel: delivery.label,
                  kind: delivery.kind,
                  ok: delivery.ok,
                  error: delivery.error,
                })),
              }));
          if (wanted.has("drawings")) {
            const subjects = symbol
              ? [symbol]
              : [...new Set(data.drawings.map((drawing) => drawing.symbol))];
            out.drawings = subjects.map((subject) => {
              const items = data.drawings.filter((drawing) => drawing.symbol === subject);
              return {
                symbol: subject,
                count: items.length,
                items: symbol
                  ? items.map(({ id, kind, points, color, text }) => ({
                      id,
                      kind,
                      points,
                      color,
                      text,
                    }))
                  : undefined,
              };
            });
          }
          if (wanted.has("overlays"))
            out.overlays = data.overlays;
          if (wanted.has("screens")) out.screens = data.screens;
          if (wanted.has("relations"))
            out.relations = data.relations
              .filter((item) => !symbol || item.owner === symbol || item.ticker === symbol)
              .slice(0, limit);
          if (wanted.has("chartTemplates"))
            out.chartTemplates = data.chartTemplates;
          if (wanted.has("settings")) out.settings = data.settings;
          if (wanted.has("desk"))
            out.desk = (data.desk ?? defaultDesk(randomUUID)).widgets;
          if (wanted.has("requests"))
            out.requests = data.requests.slice(0, 10).map((request) => ({
              id: request.id,
              query: request.query,
              symbol: request.symbol,
              answer: request.answer.slice(0, 200),
            }));
          return out;
        }, "The workspace could not be read."),
    }),
    getNote: tool({
      description: "Read one research note in full (title, symbol, body, last update) by id from getWorkspace.",
      inputSchema: z.object({ id: uuid }),
      execute: ({ id }) =>
        attempt(async () => {
          const note = (await readWorkspaceData(userId)).notes.find((item) => item.id === id);
          if (!note) throw new Error(`No note with id ${id}.`);
          return note;
        }, "The note could not be read."),
    }),
    manageWatchlists: tool({
      description:
        "Create, rename, delete or edit watchlists (max 30 lists of 120 symbols). create: name (+ optional symbols). rename: list + name. delete: list. addSymbols / removeSymbols: list + symbols. reorder: list + symbols (the full list in the new order). `list` is an id or exact name from getWorkspace.",
      inputSchema: z.object({
        action: z.enum(["create", "rename", "delete", "addSymbols", "removeSymbols", "reorder"]),
        list: z.string().max(120).optional().describe("Watchlist id or exact name"),
        name: z.string().trim().min(1).max(120).optional(),
        symbols: z.array(ticker).max(120).optional(),
      }),
      execute: ({ action, list, name, symbols }) =>
        attempt(
          () =>
            write(userId, (workspace) => {
              const lists = workspace.watchlists;
              switch (action) {
                case "create": {
                  const created = {
                    id: randomUUID(),
                    name: need(name, "Provide a name for the watchlist."),
                    symbols: [...new Set(symbols ?? [])],
                  };
                  if (lists.length >= 30) throw new Error("At most 30 watchlists are allowed.");
                  return [
                    { ...workspace, watchlists: [...lists, created] },
                    changed(`Created watchlist ${created.name}${created.symbols.length ? ` with ${created.symbols.join(", ")}` : ""}`, { watchlist: created }),
                  ];
                }
                case "rename": {
                  const target = pick(lists, list, "watchlist");
                  const next = { ...target, name: need(name, "Provide the new name.") };
                  return [
                    { ...workspace, watchlists: lists.map((item) => (item.id === target.id ? next : item)) },
                    changed(`Renamed ${target.name} to ${next.name}`, { watchlist: next }),
                  ];
                }
                case "delete": {
                  const target = pick(lists, list, "watchlist");
                  return [
                    { ...workspace, watchlists: lists.filter((item) => item.id !== target.id) },
                    changed(`Deleted watchlist ${target.name} (${target.symbols.length} symbols)`, { deleted: { id: target.id, name: target.name } }),
                  ];
                }
                case "addSymbols": {
                  const target = pick(lists, list, "watchlist");
                  const requested = need(symbols, "Provide symbols to add.");
                  const fresh = [...new Set(requested)].filter((symbol) => !target.symbols.includes(symbol));
                  if (target.symbols.length + fresh.length > 120)
                    throw new Error(`A watchlist holds at most 120 symbols; ${target.name} has ${target.symbols.length}.`);
                  const next = { ...target, symbols: [...target.symbols, ...fresh] };
                  return [
                    { ...workspace, watchlists: lists.map((item) => (item.id === target.id ? next : item)) },
                    changed(
                      fresh.length
                        ? `Added ${fresh.join(", ")} to ${target.name}`
                        : `${requested.join(", ")} already in ${target.name}`,
                      { watchlist: next, added: fresh },
                    ),
                  ];
                }
                case "removeSymbols": {
                  const target = pick(lists, list, "watchlist");
                  const drop = new Set(need(symbols, "Provide symbols to remove."));
                  const removed = target.symbols.filter((symbol) => drop.has(symbol));
                  const next = { ...target, symbols: target.symbols.filter((symbol) => !drop.has(symbol)) };
                  return [
                    { ...workspace, watchlists: lists.map((item) => (item.id === target.id ? next : item)) },
                    changed(
                      removed.length
                        ? `Removed ${removed.join(", ")} from ${target.name}`
                        : `None of those symbols are in ${target.name}`,
                      { watchlist: next, removed },
                    ),
                  ];
                }
                case "reorder": {
                  const target = pick(lists, list, "watchlist");
                  const order = [...new Set(need(symbols, "Provide the full symbol order."))];
                  const same =
                    order.length === target.symbols.length &&
                    order.every((symbol) => target.symbols.includes(symbol));
                  if (!same)
                    throw new Error("reorder needs exactly the symbols already in the list, in the new order.");
                  const next = { ...target, symbols: order };
                  return [
                    { ...workspace, watchlists: lists.map((item) => (item.id === target.id ? next : item)) },
                    changed(`Reordered ${target.name}`, { watchlist: next }),
                  ];
                }
              }
            }),
          "The watchlist could not be updated.",
        ),
    }),
    manageAlerts: tool({
      description:
        "Create and manage alert rules directly (use proposeAlert instead when the user is only exploring). Metrics: price (absolute, quote currency), change (day % vs previous close), move (% move from the price when created; the live price is captured automatically), volume (shares today). create: symbol, direction, target (+ metric, repeat once|rearm, note, channels, expires). update: id + any rule fields (changing the symbol, metric, direction or target resets trigger history). pause / arm / delete: ids (arm re-enables and re-primes). clearActivity: wipes the fired-alert log, or only these ids' events. Channels default to all active notification channels; pass ids or labels from getWorkspace, or [] for in-app only. Trigger history is server-owned and cannot be set.",
      inputSchema: z.object({
        action: z.enum(["create", "update", "delete", "pause", "arm", "clearActivity"]),
        id: uuid.optional().describe("Alert id for update"),
        ids: z.array(uuid).max(60).optional().describe("Alert ids for delete, pause, arm, clearActivity"),
        symbol: ticker.optional(),
        metric: z.enum(alertMetrics).optional().describe("Default price"),
        direction: z.enum(["above", "below"]).optional(),
        target: z
          .number()
          .finite()
          .min(-1e12)
          .max(1e12)
          .optional()
          .describe("Absolute for price and volume; percent for change and move (-5 means -5%)"),
        repeat: z.enum(["once", "rearm"]).optional().describe("Default once; rearm fires again after the condition clears"),
        note: z.string().trim().max(280).optional(),
        channels: z.array(z.string().min(1).max(80)).max(10).optional(),
        expires: z.iso.date().nullable().optional().describe("YYYY-MM-DD, or null for no expiry"),
      }),
      execute: (input) =>
        attempt(async () => {
          const { action } = input;
          const channelRecords = (await listChannels(userId)).map(publicChannel);
          const labels = new Map(channelRecords.map((channel) => [channel.id, channel.label]));
          const channelIds =
            action === "create" || (action === "update" && input.channels)
              ? await resolveChannels(userId, input.channels)
              : undefined;
          const needsQuote =
            (action === "create" && (input.metric ?? "price") === "move") ||
            (action === "update" && (input.metric === "move" || input.symbol !== undefined));
          const quoteSymbol =
            input.symbol ??
            (action === "update"
              ? (await readWorkspaceData(userId)).alerts.find((rule) => rule.id === input.id)?.symbol
              : undefined);
          const quote =
            needsQuote && quoteSymbol
              ? (await quotes([quoteSymbol]).catch(() => []))[0]
              : undefined;
          return write(userId, (workspace) => {
            const rules = workspace.alerts;
            const withRules = (next: AlertRule[]) => ({ ...workspace, alerts: next });
            switch (action) {
              case "create": {
                if (rules.length >= 60) throw new Error("At most 60 alerts are allowed. Delete some first.");
                const metric = input.metric ?? "price";
                const symbol = need(input.symbol, "Provide a symbol.");
                if (metric === "move" && !quote)
                  throw new Error(`No live quote for ${symbol}, so the move reference price cannot be set.`);
                const created: AlertRule = {
                  id: randomUUID(),
                  symbol,
                  metric,
                  direction: need(input.direction, "Provide a direction (above or below)."),
                  target: need(input.target, "Provide a target."),
                  reference: metric === "move" ? (quote?.price ?? null) : null,
                  repeat: input.repeat ?? "once",
                  primed: true,
                  enabled: true,
                  note: input.note ?? "",
                  channels: channelIds ?? [],
                  expires: input.expires ?? null,
                  lastTriggered: null,
                  triggeredPrice: null,
                  triggerCount: 0,
                };
                return [
                  withRules([created, ...rules]),
                  changed(`Created ${symbol} alert: ${describeRule(created)}`, { alert: alertView(created, labels) }),
                ];
              }
              case "update": {
                const prior = pickById(rules, input.id, "alert");
                const metric = input.metric ?? prior.metric;
                const symbol = input.symbol ?? prior.symbol;
                const reference =
                  metric !== "move"
                    ? null
                    : symbol !== prior.symbol || prior.metric !== "move"
                      ? need(
                          quote?.price,
                          `No live quote for ${symbol}, so the move reference price cannot be set.`,
                        )
                      : prior.reference;
                const next: AlertRule = {
                  ...prior,
                  symbol,
                  metric,
                  direction: input.direction ?? prior.direction,
                  target: input.target ?? prior.target,
                  reference,
                  repeat: input.repeat ?? prior.repeat,
                  note: input.note ?? prior.note,
                  channels: channelIds ?? prior.channels,
                  expires: input.expires === undefined ? prior.expires : input.expires,
                };
                const unchanged = sameRule(prior, next);
                const result: AlertRule = unchanged
                  ? next
                  : { ...next, lastTriggered: null, triggeredPrice: null, triggerCount: 0, primed: true };
                return [
                  withRules(rules.map((rule) => (rule.id === prior.id ? result : rule))),
                  changed(`Updated ${symbol} alert: ${describeRule(result)}`, { alert: alertView(result, labels) }),
                ];
              }
              case "delete": {
                const ids = need(input.ids, "Provide the alert ids to delete.");
                const missing = missingIds(rules, ids);
                if (missing.length) throw new Error(`No alert with id ${missing.join(", ")}.`);
                const gone = rules.filter((rule) => ids.includes(rule.id));
                return [
                  {
                    ...withRules(rules.filter((rule) => !ids.includes(rule.id))),
                    alertLog: workspace.alertLog.filter((event) => !ids.includes(event.alertId)),
                  },
                  changed(`Deleted ${gone.length} alert${gone.length === 1 ? "" : "s"}: ${gone.map((rule) => `${rule.symbol} ${describeRule(rule)}`).join("; ")}`, {
                    deleted: gone.map((rule) => ({ id: rule.id, symbol: rule.symbol })),
                  }),
                ];
              }
              case "pause":
              case "arm": {
                const ids = need(input.ids, `Provide the alert ids to ${action}.`);
                const missing = missingIds(rules, ids);
                if (missing.length) throw new Error(`No alert with id ${missing.join(", ")}.`);
                const touched: AlertRule[] = [];
                const next = rules.map((rule) => {
                  if (!ids.includes(rule.id)) return rule;
                  const result: AlertRule =
                    action === "pause" ? { ...rule, enabled: false } : { ...rule, enabled: true, primed: true };
                  touched.push(result);
                  return result;
                });
                return [
                  withRules(next),
                  changed(`${action === "pause" ? "Paused" : "Armed"} ${touched.map((rule) => rule.symbol).join(", ")}`, {
                    alerts: touched.map((rule) => alertView(rule, labels)),
                  }),
                ];
              }
              case "clearActivity": {
                const scope = input.ids;
                const remaining = scope
                  ? workspace.alertLog.filter((event) => !scope.includes(event.alertId))
                  : [];
                const cleared = workspace.alertLog.length - remaining.length;
                return [
                  { ...workspace, alertLog: remaining },
                  changed(`Cleared ${cleared} alert event${cleared === 1 ? "" : "s"}`, { cleared }),
                ];
              }
            }
          });
        }, "The alert could not be updated."),
    }),
    manageNotes: tool({
      description:
        "Create, edit or delete research notes (max 150; body up to 40000 characters, markdown). create: title (+ body, symbol). update: id + any of title/body/symbol (body replaces). append: id + body (added after a blank line, for journals and running logs). delete: ids. Use getNote first before rewriting a body.",
      inputSchema: z.object({
        action: z.enum(["create", "update", "append", "delete"]),
        id: uuid.optional(),
        ids: z.array(uuid).max(50).optional().describe("Note ids for delete"),
        title: z.string().trim().min(1).max(120).optional(),
        body: z.string().max(40000).optional(),
        symbol: z.union([z.literal(""), ticker]).optional().describe("Related ticker, or empty for none"),
      }),
      execute: ({ action, id, ids, title, body, symbol }) =>
        attempt(
          () =>
            write(userId, (workspace) => {
              const notes = workspace.notes;
              const now = new Date().toISOString();
              const replace = (next: (typeof notes)[number]) =>
                notes.map((note) => (note.id === next.id ? next : note));
              const brief = (note: (typeof notes)[number]) => ({
                id: note.id,
                title: note.title,
                symbol: note.symbol,
                updatedAt: note.updatedAt,
                characters: note.body.length,
              });
              switch (action) {
                case "create": {
                  if (notes.length >= 150) throw new Error("At most 150 notes are allowed.");
                  const created = {
                    id: randomUUID(),
                    title: need(title, "Provide a title."),
                    symbol: symbol ?? "",
                    body: body ?? "",
                    updatedAt: now,
                  };
                  return [
                    { ...workspace, notes: [created, ...notes] },
                    changed(`Created note “${created.title}”`, { note: brief(created) }),
                  ];
                }
                case "update": {
                  const prior = pickById(notes, id, "note");
                  const next = {
                    ...prior,
                    title: title ?? prior.title,
                    body: body ?? prior.body,
                    symbol: symbol ?? prior.symbol,
                    updatedAt: now,
                  };
                  return [
                    { ...workspace, notes: replace(next) },
                    changed(`Updated note “${next.title}”`, { note: brief(next) }),
                  ];
                }
                case "append": {
                  const prior = pickById(notes, id, "note");
                  const addition = need(body, "Provide the text to append.");
                  const next = {
                    ...prior,
                    body: prior.body ? `${prior.body}\n\n${addition}` : addition,
                    updatedAt: now,
                  };
                  return [
                    { ...workspace, notes: replace(next) },
                    changed(`Appended to note “${next.title}”`, { note: brief(next) }),
                  ];
                }
                case "delete": {
                  const targets = need(ids, "Provide the note ids to delete.");
                  const missing = missingIds(notes, targets);
                  if (missing.length) throw new Error(`No note with id ${missing.join(", ")}.`);
                  const gone = notes.filter((note) => targets.includes(note.id));
                  return [
                    { ...workspace, notes: notes.filter((note) => !targets.includes(note.id)) },
                    changed(`Deleted ${gone.length} note${gone.length === 1 ? "" : "s"}: ${gone.map((note) => `“${note.title}”`).join(", ")}`, {
                      deleted: gone.map((note) => ({ id: note.id, title: note.title })),
                    }),
                  ];
                }
              }
            }),
          "The note could not be saved.",
        ),
    }),
    managePortfolios: tool({
      description:
        "Manage portfolios (books) and their manual transactions. Broker-synced books (brokerSynced true in getWorkspace) are read-only: they cannot be renamed, deleted or have trades edited. createBook: name. renameBook: book + name. deleteBook: book (also deletes its trades). addTrades: book + trades (max 50; currency defaults to the symbol's quote currency; a sale needs enough prior shares in the same currency). updateTrade: tradeId + any trade fields. deleteTrades: tradeIds. `book` is an id or exact name.",
      inputSchema: z.object({
        action: z.enum(["createBook", "renameBook", "deleteBook", "addTrades", "updateTrade", "deleteTrades"]),
        book: z.string().max(120).optional().describe("Portfolio id or exact name"),
        name: z.string().trim().min(1).max(120).optional(),
        trades: z.array(tradeInput).max(50).optional(),
        tradeId: uuid.optional(),
        tradeIds: z.array(uuid).max(100).optional(),
        changes: tradeInput.partial().optional().describe("Fields to change for updateTrade"),
      }),
      execute: ({ action, book, name, trades, tradeId, tradeIds, changes }) =>
        attempt(async () => {
          const symbolsToPrice = [
            ...(trades ?? []).filter((trade) => !trade.currency).map((trade) => trade.symbol),
            ...(changes?.symbol && !changes.currency ? [changes.symbol] : []),
          ];
          const currencies = symbolsToPrice.length
            ? await defaultCurrencies(symbolsToPrice)
            : new Map<string, string>();
          const resolveCurrency = (symbol: string, given: string | undefined) =>
            given ?? need(currencies.get(symbol), `No quote currency found for ${symbol}; pass a currency.`);
          return write(userId, (workspace) => {
            const refuseBroker = (target: { name: string; broker?: unknown }) => {
              if (target.broker)
                throw new Error(`${target.name} is synced from a broker and read-only.`);
            };
            const valid = (next: Workspace) => {
              checkTrades(next.trades, next.books);
              return next;
            };
            switch (action) {
              case "createBook": {
                if (workspace.books.length >= 25) throw new Error("At most 25 portfolios are allowed.");
                const created = { id: randomUUID(), name: need(name, "Provide a portfolio name.") };
                return [
                  { ...workspace, books: [...workspace.books, created] },
                  changed(`Created portfolio ${created.name}`, { book: created }),
                ];
              }
              case "renameBook": {
                const target = pick(workspace.books, book, "portfolio");
                refuseBroker(target);
                const next = { ...target, name: need(name, "Provide the new name.") };
                return [
                  { ...workspace, books: workspace.books.map((item) => (item.id === target.id ? next : item)) },
                  changed(`Renamed portfolio ${target.name} to ${next.name}`, { book: next }),
                ];
              }
              case "deleteBook": {
                const target = pick(workspace.books, book, "portfolio");
                refuseBroker(target);
                const dropped = workspace.trades.filter((trade) => trade.bookId === target.id).length;
                return [
                  valid({
                    ...workspace,
                    books: workspace.books.filter((item) => item.id !== target.id),
                    trades: workspace.trades.filter((trade) => trade.bookId !== target.id),
                  }),
                  changed(`Deleted portfolio ${target.name} and its ${dropped} transactions`, {
                    deleted: { id: target.id, name: target.name, trades: dropped },
                  }),
                ];
              }
              case "addTrades": {
                const target = pick(workspace.books, book, "portfolio");
                refuseBroker(target);
                const added = need(trades, "Provide the trades to add.").map((trade) => ({
                  id: randomUUID(),
                  bookId: target.id,
                  symbol: trade.symbol,
                  side: trade.side,
                  quantity: trade.quantity,
                  price: trade.price,
                  fees: trade.fees,
                  currency: resolveCurrency(trade.symbol, trade.currency),
                  date: trade.date,
                }));
                if (workspace.trades.length + added.length > 5000)
                  throw new Error("At most 5000 transactions are allowed.");
                return [
                  valid({ ...workspace, trades: [...workspace.trades, ...added] }),
                  changed(
                    `Added ${added.length} transaction${added.length === 1 ? "" : "s"} to ${target.name}: ${added.map((trade) => `${trade.side} ${trade.quantity} ${trade.symbol}`).join(", ")}`,
                    { book: target.name, trades: added },
                  ),
                ];
              }
              case "updateTrade": {
                const prior = pickById(workspace.trades, tradeId, "transaction");
                const owner = workspace.books.find((item) => item.id === prior.bookId);
                if (owner) refuseBroker(owner);
                const edit = need(changes, "Provide the fields to change.");
                const next = {
                  ...prior,
                  symbol: edit.symbol ?? prior.symbol,
                  side: edit.side ?? prior.side,
                  quantity: edit.quantity ?? prior.quantity,
                  price: edit.price ?? prior.price,
                  fees: edit.fees ?? prior.fees,
                  currency: edit.symbol
                    ? resolveCurrency(edit.symbol, edit.currency)
                    : (edit.currency ?? prior.currency),
                  date: edit.date ?? prior.date,
                };
                return [
                  valid({
                    ...workspace,
                    trades: workspace.trades.map((trade) => (trade.id === prior.id ? next : trade)),
                  }),
                  changed(`Updated ${next.side} ${next.quantity} ${next.symbol} on ${next.date}`, { trade: next }),
                ];
              }
              case "deleteTrades": {
                const ids = need(tradeIds, "Provide the transaction ids to delete.");
                const missing = missingIds(workspace.trades, ids);
                if (missing.length) throw new Error(`No transaction with id ${missing.join(", ")}.`);
                const gone = workspace.trades.filter((trade) => ids.includes(trade.id));
                const synced = new Set(workspace.books.filter((item) => item.broker).map((item) => item.id));
                if (gone.some((trade) => synced.has(trade.bookId)))
                  throw new Error("Transactions in broker-synced portfolios are read-only.");
                return [
                  valid({ ...workspace, trades: workspace.trades.filter((trade) => !ids.includes(trade.id)) }),
                  changed(`Deleted ${gone.length} transaction${gone.length === 1 ? "" : "s"}`, {
                    deleted: gone.map((trade) => ({ id: trade.id, symbol: trade.symbol, date: trade.date })),
                  }),
                ];
              }
            }
          });
        }, "The portfolio could not be updated."),
    }),
    manageDrawings: tool({
      description: `Chart drawings that persist on a symbol's chart. add: symbol, kind and points (anchors are {t unix seconds, p price}); points needed per kind: ${drawingKinds.map((kind) => `${kind} ${toolPoints[kind]} (${toolLabels[kind]})`).join(", ")}. text takes a label in text. remove: ids. clear: symbol (removes all its drawings; confirm with the user first). Use getPriceHistory to find sensible timestamps and levels.`,
      inputSchema: z.object({
        action: z.enum(["add", "remove", "clear"]),
        symbol: ticker.optional(),
        kind: z.enum(drawingKinds).optional(),
        points: z.array(drawingPoint).min(1).max(3).optional(),
        color: chartColorSchema.optional().describe("#RRGGBB, default amber"),
        text: z.string().trim().max(200).optional(),
        ids: z.array(uuid).max(100).optional(),
      }),
      execute: ({ action, symbol, kind, points, color, text, ids }) =>
        attempt(
          () =>
            write(userId, (workspace) => {
              switch (action) {
                case "add": {
                  const chosen = need(kind, "Provide a drawing kind.");
                  const anchors = need(points, "Provide the anchor points.");
                  if (anchors.length !== toolPoints[chosen])
                    throw new Error(`A ${toolLabels[chosen].toLowerCase()} needs exactly ${toolPoints[chosen]} point(s).`);
                  const created = {
                    id: randomUUID(),
                    symbol: need(symbol, "Provide a symbol."),
                    kind: chosen,
                    points: anchors,
                    color: color ?? "#e0a030",
                    ...(text ? { text } : {}),
                  };
                  if (workspace.drawings.length >= 600) throw new Error("At most 600 drawings are allowed.");
                  return [
                    { ...workspace, drawings: [...workspace.drawings, created] },
                    changed(`Drew ${toolLabels[chosen].toLowerCase()} on ${created.symbol}`, { drawing: created }),
                  ];
                }
                case "remove": {
                  const targets = need(ids, "Provide the drawing ids to remove.");
                  const missing = missingIds(workspace.drawings, targets);
                  if (missing.length) throw new Error(`No drawing with id ${missing.join(", ")}.`);
                  return [
                    { ...workspace, drawings: workspace.drawings.filter((item) => !targets.includes(item.id)) },
                    changed(`Removed ${targets.length} drawing${targets.length === 1 ? "" : "s"}`, { removed: targets }),
                  ];
                }
                case "clear": {
                  const subject = need(symbol, "Provide the symbol to clear.");
                  const count = workspace.drawings.filter((item) => item.symbol === subject).length;
                  return [
                    { ...workspace, drawings: workspace.drawings.filter((item) => item.symbol !== subject) },
                    changed(`Cleared ${count} drawing${count === 1 ? "" : "s"} on ${subject}`, { cleared: count }),
                  ];
                }
              }
            }),
          "The drawing could not be saved.",
        ),
    }),
    manageOverlays: tool({
      description:
        "Saved overlay charts (max 30). A spec is series joined by ';', each 'expr,axis,mode,flags,studies': expr is a symbol, FRED:<id> or arithmetic ('NVDA / SMH', '(XLY / XLP) * 100'); axis l|r|p; mode p (level) | r (% from start) | z (z-score); flags 'i' inverts; studies '+'-joined (sma20, sma50, sma100, sma200, ema9, ema21, ema50, bollinger, rsi, macd). Example '^GSPC,l,p,,sma200;^VIX,r,p,i'. create: name, spec, range. update: id + any field. delete: id.",
      inputSchema: z.object({
        action: z.enum(["create", "update", "delete"]),
        id: uuid.optional(),
        name: z.string().trim().min(1).max(120).optional(),
        spec: z.string().trim().min(1).max(800).optional(),
        range: z.enum(overlayRanges).optional().describe("Default 1Y"),
      }),
      execute: ({ action, id, name, spec, range }) =>
        attempt(
          () =>
            write(userId, (workspace) => {
              const items = workspace.overlays;
              const checked = (value: string) => {
                if (!decodeOverlay(value).length)
                  throw new Error("The overlay spec has no valid series; check the expressions.");
                return value;
              };
              switch (action) {
                case "create": {
                  if (items.length >= 30) throw new Error("At most 30 overlays are allowed.");
                  const created = {
                    id: randomUUID(),
                    name: need(name, "Provide a name."),
                    spec: checked(need(spec, "Provide a spec.")),
                    range: range ?? "1Y",
                  };
                  return [
                    { ...workspace, overlays: [...items, created] },
                    changed(`Saved overlay ${created.name}`, { overlay: created }),
                  ];
                }
                case "update": {
                  const prior = pickById(items, id, "overlay");
                  const next = {
                    ...prior,
                    name: name ?? prior.name,
                    spec: spec === undefined ? prior.spec : checked(spec),
                    range: range ?? prior.range,
                  };
                  return [
                    { ...workspace, overlays: items.map((item) => (item.id === prior.id ? next : item)) },
                    changed(`Updated overlay ${next.name}`, { overlay: next }),
                  ];
                }
                case "delete": {
                  const prior = pickById(items, id, "overlay");
                  return [
                    { ...workspace, overlays: items.filter((item) => item.id !== prior.id) },
                    changed(`Deleted overlay ${prior.name}`, { deleted: { id: prior.id, name: prior.name } }),
                  ];
                }
              }
            }),
          "The overlay could not be saved.",
        ),
    }),
    manageScreens: tool({
      description:
        "Saved equity screens (max 20), identified by name. Ranges are [min, max] as number strings with '' for unbounded: price (quote currency), day (% today), period (% over lookback), position (% of 52-week range, 0 = at the low, 100 = at the high); turnover is a minimum traded value (price x volume) as a number string; sectors and query narrow the S&P 500 universe. create/update upsert by name; delete removes by name.",
      inputSchema: z.object({
        action: z.enum(["save", "delete"]),
        name: z.string().trim().min(1).max(80),
        sectors: screenSchema.shape.sectors.optional(),
        query: screenSchema.shape.query.optional(),
        price: screenSchema.shape.price.optional(),
        day: screenSchema.shape.day.optional(),
        period: screenSchema.shape.period.optional(),
        position: screenSchema.shape.position.optional(),
        turnover: screenSchema.shape.turnover.optional(),
        lookback: z.enum(lookbackKeys).optional().describe("Default YTD"),
      }),
      execute: ({ action, name, ...fields }) =>
        attempt(
          () =>
            write(userId, (workspace) => {
              const key = name.toLowerCase();
              const index = workspace.screens.findIndex((screen) => screen.name.toLowerCase() === key);
              if (action === "delete") {
                if (index < 0) throw new Error(`No screen named "${name}".`);
                return [
                  { ...workspace, screens: workspace.screens.filter((_, i) => i !== index) },
                  changed(`Deleted screen ${name}`, { deleted: name }),
                ];
              }
              const blank = { sectors: [], query: "", price: ["", ""], day: ["", ""], period: ["", ""], position: ["", ""], turnover: "", lookback: "YTD" };
              const prior = index >= 0 ? workspace.screens[index] : undefined;
              const defined = Object.fromEntries(
                Object.entries(fields).filter(([, value]) => value !== undefined),
              );
              const next = screenSchema.parse({ ...blank, ...prior, ...defined, name });
              if (index < 0 && workspace.screens.length >= 20) throw new Error("At most 20 screens are allowed.");
              return [
                {
                  ...workspace,
                  screens: index < 0 ? [...workspace.screens, next] : workspace.screens.map((screen, i) => (i === index ? next : screen)),
                },
                changed(`${prior ? "Updated" : "Saved"} screen ${name}`, { screen: next }),
              ];
            }),
          "The screen could not be saved.",
        ),
    }),
    manageRelations: tool({
      description:
        "Supply-chain and competitive relationship notes between companies (max 400). create: owner (the company the note is about), counterparty (name), role (supplier|customer|partner|competitor), optional ticker of the counterparty, share (fraction of revenue 0-1), note. update: id + any field. delete: ids.",
      inputSchema: z.object({
        action: z.enum(["create", "update", "delete"]),
        id: uuid.optional(),
        ids: z.array(uuid).max(50).optional(),
        owner: ticker.optional(),
        counterparty: relationNoteSchema.shape.counterparty.optional(),
        ticker: ticker.nullable().optional(),
        role: relationNoteSchema.shape.role.optional(),
        share: relationNoteSchema.shape.share.optional(),
        note: relationNoteSchema.shape.note.optional(),
      }),
      execute: ({ action, id, ids, owner, counterparty, ticker: peer, role, share, note }) =>
        attempt(
          () =>
            write(userId, (workspace) => {
              const items = workspace.relations;
              switch (action) {
                case "create": {
                  if (items.length >= 400) throw new Error("At most 400 relationship notes are allowed.");
                  const created = {
                    id: randomUUID(),
                    owner: need(owner, "Provide the owner symbol."),
                    counterparty: need(counterparty, "Provide the counterparty name."),
                    ticker: peer ?? null,
                    role: need(role, "Provide the role."),
                    share: share ?? null,
                    note: note ?? "",
                    created: today(),
                  };
                  return [
                    { ...workspace, relations: [...items, created] },
                    changed(`Added ${created.role} ${created.counterparty} to ${created.owner}`, { relation: created }),
                  ];
                }
                case "update": {
                  const prior = pickById(items, id, "relationship note");
                  const next = {
                    ...prior,
                    owner: owner ?? prior.owner,
                    counterparty: counterparty ?? prior.counterparty,
                    ticker: peer === undefined ? prior.ticker : peer,
                    role: role ?? prior.role,
                    share: share === undefined ? prior.share : share,
                    note: note ?? prior.note,
                  };
                  return [
                    { ...workspace, relations: items.map((item) => (item.id === prior.id ? next : item)) },
                    changed(`Updated ${next.owner} ${next.role} ${next.counterparty}`, { relation: next }),
                  ];
                }
                case "delete": {
                  const targets = need(ids, "Provide the ids to delete.");
                  const missing = missingIds(items, targets);
                  if (missing.length) throw new Error(`No relationship note with id ${missing.join(", ")}.`);
                  return [
                    { ...workspace, relations: items.filter((item) => !targets.includes(item.id)) },
                    changed(`Deleted ${targets.length} relationship note${targets.length === 1 ? "" : "s"}`, { deleted: targets }),
                  ];
                }
              }
            }),
          "The relationship note could not be saved.",
        ),
    }),
    manageChartTemplates: tool({
      description: `Reusable chart layouts (max 30). create: name plus style (${chartStyles.join("|")}), studies, scale (${chartScales.join("|")}), custom averages (${averageKinds.join("|")} with period and #RRGGBB color), oscillator panes and appearance. update: id + any field. delete: id. Omitted fields default to line style area, linear scale, nothing extra.`,
      inputSchema: z.object({
        action: z.enum(["create", "update", "delete"]),
        id: uuid.optional(),
        name: z.string().trim().min(1).max(60).optional(),
        style: z.enum(chartStyles).optional(),
        studies: z.array(studyKeySchema).max(12).optional(),
        scale: z.enum(chartScales).optional(),
        averages: z.array(customAverageSchema).max(8).optional(),
        panes: z.array(customPaneSchema).max(4).optional(),
        appearance: chartAppearanceSchema.partial().optional(),
      }),
      execute: ({ action, id, name, style, studies, scale, averages, panes, appearance }) =>
        attempt(
          () =>
            write(userId, (workspace) => {
              const items = workspace.chartTemplates;
              switch (action) {
                case "create": {
                  if (items.length >= 30) throw new Error("At most 30 chart templates are allowed.");
                  const created = {
                    id: randomUUID(),
                    name: need(name, "Provide a template name."),
                    style: style ?? "area",
                    studies: studies ?? [],
                    scale: scale ?? "linear",
                    averages: averages ?? [],
                    panes: panes ?? [],
                    appearance: chartAppearanceSchema.parse(appearance ?? {}),
                  };
                  return [
                    { ...workspace, chartTemplates: [...items, created] },
                    changed(`Saved chart template ${created.name}`, { template: created }),
                  ];
                }
                case "update": {
                  const prior = pickById(items, id, "chart template");
                  const next = {
                    ...prior,
                    name: name ?? prior.name,
                    style: style ?? prior.style,
                    studies: studies ?? prior.studies,
                    scale: scale ?? prior.scale,
                    averages: averages ?? prior.averages,
                    panes: panes ?? prior.panes,
                    appearance: { ...prior.appearance, ...appearance },
                  };
                  return [
                    { ...workspace, chartTemplates: items.map((item) => (item.id === prior.id ? next : item)) },
                    changed(`Updated chart template ${next.name}`, { template: next }),
                  ];
                }
                case "delete": {
                  const prior = pickById(items, id, "chart template");
                  return [
                    { ...workspace, chartTemplates: items.filter((item) => item.id !== prior.id) },
                    changed(`Deleted chart template ${prior.name}`, { deleted: { id: prior.id, name: prior.name } }),
                  ];
                }
              }
            }),
          "The chart template could not be saved.",
        ),
    }),
    updateSettings: tool({
      description:
        "Change the user's app settings; only the fields you pass change. theme: light|dark|system|terminal. home: landing view overview|markets|portfolio|research. refresh: live auto-refresh on/off. chart: default chart preferences (style, range, studies, log, scale, averages, panes, appearance flags/colors).",
      inputSchema: z.object({
        theme: z.enum(["light", "dark", "system", "terminal"]).optional(),
        home: z.enum(["overview", "markets", "portfolio", "research"]).optional(),
        refresh: z.boolean().optional(),
        chart: z
          .object({
            style: z.enum(chartStyles).optional(),
            range: z.enum(rangeKeys).optional(),
            studies: z.array(studyKeySchema).max(12).optional(),
            log: z.boolean().optional(),
            scale: z.enum(chartScales).optional(),
            averages: z.array(customAverageSchema).max(8).optional(),
            panes: z.array(customPaneSchema).max(4).optional(),
            appearance: chartAppearanceSchema.partial().optional(),
          })
          .optional(),
      }),
      execute: ({ theme, home, refresh, chart }) =>
        attempt(
          () =>
            write(userId, (workspace) => {
              const { settings } = workspace;
              const defined = Object.fromEntries(
                Object.entries(chart ?? {}).filter(([, value]) => value !== undefined),
              );
              const nextChart = chartPreferencesSchema.parse({
                ...settings.chart,
                ...defined,
                appearance: { ...settings.chart.appearance, ...chart?.appearance },
              });
              const next = {
                theme: theme ?? settings.theme,
                home: home ?? settings.home,
                refresh: refresh ?? settings.refresh,
                chart: nextChart,
              };
              const parts = [
                theme && `theme ${theme}`,
                home && `home ${home}`,
                refresh !== undefined && `auto-refresh ${refresh ? "on" : "off"}`,
                chart && "chart defaults",
              ].filter(Boolean);
              if (!parts.length) throw new Error("Pass at least one setting to change.");
              return [
                { ...workspace, settings: next },
                changed(`Settings updated: ${parts.join(", ")}`, { settings: next }),
              ];
            }),
          "The settings could not be updated.",
        ),
    }),
  };
}
