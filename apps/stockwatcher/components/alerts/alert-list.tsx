"use client";

import { Bell, BellOff, Pencil, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeRule, expired, formatTarget, reading } from "@/lib/alerts";
import type { AlertEvent, AlertRule, Quote } from "@/lib/models";
import type { Channel } from "@/lib/notify/types";
import { amount } from "@/lib/utils";
import { SymbolLink, Tick } from "../shared";
import { DeliveryRoute } from "./delivery-route";
import { ago, type Distance, distance, fullTime } from "./format";

export type AlertState = "armed" | "resetting" | "fired" | "paused" | "expired";

export function alertState(rule: AlertRule): AlertState {
  if (expired(rule)) return "expired";
  if (rule.enabled) return rule.primed ? "armed" : "resetting";
  return rule.lastTriggered && rule.repeat === "once" ? "fired" : "paused";
}

const groups: { state: AlertState; title: string; note: string }[] = [
  {
    state: "armed",
    title: "Armed",
    note: "Checked every two minutes · closest to triggering first",
  },
  {
    state: "resetting",
    title: "Waiting to reset",
    note: "Went off and will arm again once the condition clears",
  },
  {
    state: "fired",
    title: "Fired",
    note: "One-time alerts that went off · re-arm or delete them",
  },
  { state: "paused", title: "Paused", note: "Not being checked" },
  {
    state: "expired",
    title: "Expired",
    note: "Past their end date · edit to extend",
  },
];

type Handlers = {
  select: (ticker: string) => void;
  toggle: (rule: AlertRule) => void;
  edit: (rule: AlertRule) => void;
  remove: (rule: AlertRule) => void;
  history: (rule: AlertRule) => void;
};

export function AlertList({
  alerts,
  quotes,
  loading,
  channels,
  latest,
  counts,
  ...handlers
}: {
  alerts: AlertRule[];
  quotes: Map<string, Quote>;
  loading: boolean;
  channels: Map<string, Channel>;
  latest: Map<string, AlertEvent>;
  counts: Map<string, number>;
} & Handlers) {
  const measured = alerts.map((rule) => ({
    rule,
    state: alertState(rule),
    distance: distance(rule, quotes.get(rule.symbol)),
  }));
  return (
    <div className="alert-rows">
      <div className="alert-row alert-row-head" aria-hidden>
        <span className="c-sym">Symbol</span>
        <span className="c-cond">Condition</span>
        <span className="c-now">Now</span>
        <span className="c-dist">To trigger</span>
        <span className="c-route">Delivers to</span>
        <span className="c-last">Last fired</span>
        <span className="c-actions" />
      </div>
      {groups.map((group) => {
        const rows = measured
          .filter((item) => item.state === group.state)
          .sort(
            (a, b) =>
              (b.distance?.closeness ?? -1) - (a.distance?.closeness ?? -1),
          );
        if (!rows.length) return null;
        return (
          <section
            key={group.state}
            className="alert-group"
            aria-label={`${group.title}, ${rows.length}`}
          >
            <h3 className="alert-group-title">
              <span className="status" data-status={group.state}>
                {group.title}
              </span>
              <span className="alert-group-count">{rows.length}</span>
              <span className="alert-group-note">{group.note}</span>
            </h3>
            <ul>
              {rows.map((item) => (
                <AlertRow
                  key={item.rule.id}
                  rule={item.rule}
                  state={item.state}
                  distance={item.distance}
                  quote={quotes.get(item.rule.symbol)}
                  loading={loading}
                  channels={channels}
                  last={latest.get(item.rule.id)}
                  logged={counts.get(item.rule.id) ?? 0}
                  {...handlers}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AlertRow({
  rule,
  state,
  distance,
  quote,
  loading,
  channels,
  last,
  logged,
  select,
  toggle,
  edit,
  remove,
  history,
}: {
  rule: AlertRule;
  state: AlertState;
  distance: Distance | null;
  quote: Quote | undefined;
  loading: boolean;
  channels: Map<string, Channel>;
  last: AlertEvent | undefined;
  logged: number;
} & Handlers) {
  const value = reading(rule, quote);
  const live = state === "armed" || state === "resetting";
  return (
    <li className="alert-row" data-state={state}>
      <div className="c-sym">
        <SymbolLink symbol={rule.symbol} select={select} label={quote?.name} />
        {quote?.name ? (
          <span className="alert-name" title={quote.name}>
            {quote.name}
          </span>
        ) : null}
      </div>
      <div className="c-cond">
        <span className="alert-condition-text">{describeRule(rule)}</span>
        {rule.repeat === "rearm" || rule.expires || rule.note ? (
          <span className="alert-detail">
            {rule.repeat === "rearm" ? (
              <span>
                <Repeat size={11} aria-hidden /> Every crossing
              </span>
            ) : null}
            {rule.expires ? (
              <span>
                {state === "expired" ? "Ended" : "Until"} {rule.expires}
              </span>
            ) : null}
            {rule.note ? (
              <span className="alert-note" title={rule.note}>
                {rule.note}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="alert-reading">
        <span className="c-now num">
          <span className="narrow-label">Now </span>
          {loading && !quote ? (
            <span className="number-placeholder" aria-label="Loading" />
          ) : rule.metric === "price" ? (
            <Tick value={quote?.price} />
          ) : value != null ? (
            formatTarget(rule.metric, value)
          ) : (
            "—"
          )}
          {rule.metric === "price" && quote?.currency ? (
            <span className="alert-ccy"> {quote.currency}</span>
          ) : null}
        </span>
        <span
          className="c-dist"
          data-met={distance?.met || undefined}
          data-live={live || undefined}
        >
          {distance ? (
            <>
              <span className="meter" aria-hidden>
                <span style={{ inlineSize: `${distance.closeness * 100}%` }} />
              </span>
              <span className="dist-text">{distance.text}</span>
            </>
          ) : loading ? null : (
            <span className="muted">No quote</span>
          )}
        </span>
      </div>
      <div className="alert-meta">
        <div className="c-route">
          <DeliveryRoute ids={rule.channels} channels={channels} last={last} />
        </div>
        <div className="c-last">
          {rule.lastTriggered ? (
            <button
              type="button"
              className="last-fired"
              title={`${fullTime(rule.lastTriggered)} · show in history`}
              disabled={!logged}
              onClick={() => history(rule)}
            >
              <span className="narrow-label">Fired </span>
              {ago(rule.lastTriggered)}
              <span className="last-fired-sub">
                at {amount(rule.triggeredPrice)}
                {rule.triggerCount > 1 ? ` · ${rule.triggerCount}×` : ""}
              </span>
            </button>
          ) : (
            <span className="muted">
              <span className="narrow-label">Fired </span>never
            </span>
          )}
        </div>
      </div>
      <div className="c-actions row-actions row-actions-end">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={rule.enabled ? "Pause alert" : "Arm alert"}
          title={rule.enabled ? "Pause" : "Arm again"}
          onClick={() => toggle(rule)}
        >
          {rule.enabled ? <BellOff /> : <Bell />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Edit alert"
          title="Edit"
          onClick={() => edit(rule)}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Delete alert"
          title="Delete"
          onClick={() => remove(rule)}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}
