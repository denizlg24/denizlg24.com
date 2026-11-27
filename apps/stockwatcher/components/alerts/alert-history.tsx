"use client";

import { BellRing, Check, CircleAlert, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { describeRule } from "@/lib/alerts";
import type { AlertEvent, AlertRule, Signal } from "@/lib/models";
import { amount } from "@/lib/utils";
import { api, Empty, PanelHeading, SectionFoot, SymbolLink } from "../shared";
import { channelMeta } from "./channel-guide";
import { clockTime, dayLabel, fullTime } from "./format";

export type HistoryFocus = { id: string; label: string };

const page = 40;

const failedCount = (event: AlertEvent) =>
  event.deliveries.filter((item) => !item.ok).length;

/** The rule line the monitor wrote into the message, for alerts deleted since. */
const ruleFromMessage = (message: string) =>
  message
    .split("\n")
    .find((line) => line.startsWith("Rule: "))
    ?.slice(6)
    .replace(/\.$/, "");

const headline = (message: string) => message.split("\n")[0] ?? "";

export function AlertHistory({
  log,
  alerts,
  signals,
  focus,
  setFocus,
  select,
  reload,
  notify,
}: {
  log: AlertEvent[];
  alerts: AlertRule[];
  signals: Signal[];
  focus: HistoryFocus | null;
  setFocus: (focus: HistoryFocus | null) => void;
  select: (ticker: string) => void;
  reload: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [failedOnly, setFailedOnly] = useState(false);
  const [shown, setShown] = useState(page);
  const [clearing, setClearing] = useState(false);
  const rules = new Map(alerts.map((item) => [item.id, item]));
  const signalNames = new Map(signals.map((item) => [item.id, item.name]));
  const failures = log.filter((event) => failedCount(event) > 0).length;
  const events = log.filter(
    (event) =>
      (!focus || event.alertId === focus.id) &&
      (!failedOnly || failedCount(event) > 0),
  );
  const now = Date.now();
  const days: { label: string; events: AlertEvent[] }[] = [];
  for (const event of events.slice(0, shown)) {
    const label = dayLabel(event.time, now);
    const current = days.at(-1);
    if (current?.label === label) current.events.push(event);
    else days.push({ label, events: [event] });
  }

  return (
    <section
      id="alert-history"
      className="panel alert-history"
      aria-labelledby="history-title"
      tabIndex={-1}
    >
      <PanelHeading
        title="Trigger history"
        subtitle="Every time an alert or signal went off, with the price and where the message was delivered."
      >
        {log.length ? (
          <div className="row-actions">
            <div className="seg" aria-label="Filter history">
              <button
                type="button"
                aria-pressed={!failedOnly}
                onClick={() => setFailedOnly(false)}
              >
                All {log.length}
              </button>
              <button
                type="button"
                aria-pressed={failedOnly}
                disabled={!failures && !failedOnly}
                onClick={() => setFailedOnly(true)}
              >
                Failed {failures}
              </button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={clearing}
              onClick={() => {
                setClearing(true);
                api("/api/alerts/log", { method: "DELETE" })
                  .then(() => {
                    setFocus(null);
                    reload();
                  })
                  .catch((error: Error) => notify(error.message, true))
                  .finally(() => setClearing(false));
              }}
            >
              {clearing ? "Clearing…" : "Clear"}
            </Button>
          </div>
        ) : null}
      </PanelHeading>
      {focus ? (
        <p className="history-focus">
          <span>
            Showing <b>{focus.label}</b> only
          </span>
          <button type="button" className="chip" onClick={() => setFocus(null)}>
            <X aria-hidden /> Show all
          </button>
        </p>
      ) : null}
      {days.length ? (
        <>
          {days.map((group) => (
            <section key={group.label} className="history-day">
              <h3 className="history-day-title">
                {group.label}
                <span>{group.events.length}</span>
              </h3>
              <ol className="history-list">
                {group.events.map((event) => {
                  const rule = rules.get(event.alertId);
                  const condition = rule
                    ? describeRule(rule)
                    : ruleFromMessage(event.message);
                  const name =
                    event.label || signalNames.get(event.alertId) || "Signal";
                  return (
                    <li key={event.id} className="history-row">
                      <time dateTime={event.time} title={fullTime(event.time)}>
                        {clockTime(event.time)}
                      </time>
                      <div className="history-what">
                        <p className="history-head">
                          {event.symbol ? (
                            <SymbolLink symbol={event.symbol} select={select} />
                          ) : (
                            <strong>{name}</strong>
                          )}
                          {event.price != null ? (
                            <span className="num">
                              {amount(event.price)}
                              {event.currency ? (
                                <span className="muted"> {event.currency}</span>
                              ) : null}
                            </span>
                          ) : null}
                          {condition ? (
                            <span className="history-rule">{condition}</span>
                          ) : null}
                        </p>
                        <p className="history-message" title={event.message}>
                          {headline(event.message)}
                        </p>
                      </div>
                      <ul
                        className="history-deliveries"
                        aria-label="Delivered to"
                      >
                        <li data-ok="true">
                          <BellRing size={12} aria-hidden /> App
                          <Check size={11} aria-label="delivered" />
                        </li>
                        {event.deliveries.map((item) => {
                          const Icon = channelMeta[item.kind].icon;
                          return (
                            <li key={item.channel} data-ok={item.ok}>
                              {item.ok ? (
                                <Icon size={12} aria-hidden />
                              ) : (
                                <CircleAlert size={12} aria-hidden />
                              )}
                              <span className="route-name">{item.label}</span>
                              {item.ok ? (
                                <Check size={11} aria-label="delivered" />
                              ) : (
                                <span className="delivery-error">
                                  {item.error ?? "Not delivered"}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {events.length > shown ? (
            <Button
              size="sm"
              variant="ghost"
              className="history-more"
              onClick={() => setShown(shown + page)}
            >
              Show {Math.min(page, events.length - shown)} more of{" "}
              {events.length - shown}
            </Button>
          ) : null}
          <SectionFoot>
            <span>Times in your local time zone</span>
            <span>Keeps the latest 120 events</span>
          </SectionFoot>
        </>
      ) : log.length ? (
        <Empty
          title={
            failedOnly
              ? "No failed deliveries"
              : "Nothing logged for this alert"
          }
        >
          {failedOnly
            ? "Every message in the history reached its channels."
            : "Older events may have been cleared or rolled off the history."}
        </Empty>
      ) : (
        <Empty title="Nothing has fired yet">
          When an alert or signal goes off, it is listed here with the price at
          that moment and whether each channel received it.
        </Empty>
      )}
    </section>
  );
}
