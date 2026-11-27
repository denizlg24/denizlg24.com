"use client";

import { Check, CircleAlert, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { describeRule } from "@/lib/alerts";
import type { AlertEvent, AlertRule, ChannelKind, Signal } from "@/lib/models";
import { cn } from "@/lib/utils";
import { type AlertDraft, AlertEditor } from "./alerts/alert-editor";
import { AlertHistory, type HistoryFocus } from "./alerts/alert-history";
import { AlertList, alertState } from "./alerts/alert-list";
import { ChannelGuide } from "./alerts/channel-guide";
import { ChannelsPanel } from "./alerts/channels-panel";
import { ago, distance, latestEvents, nearCloseness } from "./alerts/format";
import { SignalsPanel } from "./alerts/signals-panel";
import { useChannels } from "./alerts/use-channels";
import { RemoveDialog, type Save } from "./forms";
import { useQuotes } from "./market-widgets";
import { Empty, SectionFoot } from "./shared";

type Outcome = { ok: true; channel: string } | { ok: false; reason: string };

/** Reads, then strips, the result Discord or Slack sent the browser back with. */
function useConnectOutcome() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("connect");
    if (status !== "ok" && status !== "error") return;
    setOutcome(
      status === "ok"
        ? { ok: true, channel: params.get("channel") || "The channel" }
        : { ok: false, reason: params.get("reason") || "That didn’t work." },
    );
    for (const key of ["connect", "channel", "reason"]) params.delete(key);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, []);
  return [outcome, () => setOutcome(null)] as const;
}

function ConnectOutcome({
  outcome,
  dismiss,
}: {
  outcome: Outcome;
  dismiss: () => void;
}) {
  return (
    <div
      className="connect-outcome"
      data-ok={outcome.ok}
      role={outcome.ok ? "status" : "alert"}
    >
      {outcome.ok ? <Check size={16} /> : <CircleAlert size={16} />}
      <span>
        {outcome.ok ? (
          <>
            <b>{outcome.channel}</b> is connected. Press <b>Test</b> on it under
            Where alerts reach you to check, then tick it under Notify on any
            alert.
          </>
        ) : (
          <>
            <b>The channel wasn’t connected.</b> {outcome.reason} You can try
            again under Where alerts reach you.
          </>
        )}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <X />
      </Button>
    </div>
  );
}

export function Alerts({
  alerts,
  signals,
  log: unsorted,
  ticker,
  save,
  reload,
  refresh,
  demo,
  monitoring,
  select,
  proposed,
  clearProposed,
  notify,
}: {
  alerts: AlertRule[];
  signals: Signal[];
  log: AlertEvent[];
  ticker: string;
  save: Save;
  reload: () => void;
  refresh: boolean;
  demo: boolean;
  monitoring: boolean;
  select: (ticker: string) => void;
  proposed: AlertDraft | null;
  clearProposed: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [editing, setEditing] = useState<{
    rule?: AlertRule;
    draft?: AlertDraft;
  } | null>(null);
  const [removing, setRemoving] = useState<AlertRule>();
  const [guide, setGuide] = useState<ChannelKind | null>(null);
  const [focus, setFocus] = useState<HistoryFocus | null>(null);
  const [outcome, dismissOutcome] = useConnectOutcome();
  const { data: channelData, mutate: refreshChannels } = useChannels();
  const { data, isLoading } = useQuotes(
    alerts.map((item) => item.symbol),
    refresh,
  );
  const quotes = new Map(data?.quotes.map((item) => [item.symbol, item]));
  const channels = new Map(channelData.channels.map((item) => [item.id, item]));
  const log = unsorted.toSorted(
    (a, b) => Date.parse(b.time) - Date.parse(a.time),
  );
  const latest = latestEvents(log);
  const logged = new Map<string, number>();
  for (const event of log)
    logged.set(event.alertId, (logged.get(event.alertId) ?? 0) + 1);
  const usage = new Map<string, { alerts: number; signals: number }>();
  for (const [list, key] of [
    [alerts, "alerts"],
    [signals, "signals"],
  ] as const)
    for (const item of list)
      for (const id of item.channels) {
        const entry = usage.get(id) ?? { alerts: 0, signals: 0 };
        entry[key] += 1;
        usage.set(id, entry);
      }

  const week = Date.now() - 7 * 86_400_000;
  const recent = log.filter((event) => Date.parse(event.time) >= week);
  const armed = alerts.filter((item) => alertState(item) === "armed");
  const near = armed.filter(
    (item) =>
      (distance(item, quotes.get(item.symbol))?.closeness ?? 0) >=
      nearCloseness,
  ).length;
  const failed = recent.filter((event) =>
    event.deliveries.some((item) => !item.ok),
  ).length;

  const open = editing ?? (proposed ? { draft: proposed } : null);
  const closeEditor = () => {
    setEditing(null);
    clearProposed();
  };

  const toggle = (item: AlertRule) =>
    void save((workspace) => ({
      ...workspace,
      alerts: workspace.alerts.map((entry) =>
        entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry,
      ),
    })).catch((error: Error) => notify(error.message, true));

  const showHistory = (next: HistoryFocus) => {
    setFocus(next);
    requestAnimationFrame(() => {
      const target = document.getElementById("alert-history");
      target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="alerts-view">
      {outcome ? (
        <ConnectOutcome outcome={outcome} dismiss={dismissOutcome} />
      ) : null}
      <section className="panel alerts-panel" aria-labelledby="alerts-title">
        <div className="panel-heading">
          <div>
            <h2 id="alerts-title">Alerts</h2>
            <p>
              {demo || !monitoring
                ? "Alerts can be set up here, but background checks are off in this session, so none will go off."
                : "Checked every two minutes. Right-click any chart, or use its bell tool, to set one at a price."}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setEditing({ draft: { symbol: ticker } })}
          >
            <Plus /> New alert
          </Button>
        </div>
        {alerts.length || log.length ? (
          <div className="stat-row alert-summary">
            <div className="figure">
              <span className="figure-label">Armed</span>
              <strong className="figure-value">
                {armed.length}
                <span className="figure-of"> of {alerts.length}</span>
              </strong>
            </div>
            <div className="figure">
              <span className="figure-label">Close to triggering</span>
              <strong className="figure-value">{near}</strong>
              <span className="figure-sub">within 2% or 2 pts</span>
            </div>
            <div className="figure">
              <span className="figure-label">Went off · 7 days</span>
              <strong className="figure-value">{recent.length}</strong>
              <span className="figure-sub">
                {log[0] ? `last ${ago(log[0].time)}` : "none logged"}
              </span>
            </div>
            <div className="figure">
              <span className="figure-label">Delivery problems · 7 days</span>
              <strong
                className={cn("figure-value", failed ? "negative" : undefined)}
              >
                {failed}
              </strong>
              {failed ? (
                <button
                  type="button"
                  className="figure-sub figure-link"
                  onClick={() =>
                    document
                      .getElementById("alert-history")
                      ?.scrollIntoView({ block: "start" })
                  }
                >
                  See history
                </button>
              ) : (
                <span className="figure-sub">all delivered</span>
              )}
            </div>
          </div>
        ) : null}
        {alerts.length ? (
          <>
            <AlertList
              alerts={alerts}
              quotes={quotes}
              loading={isLoading}
              channels={channels}
              latest={latest}
              counts={logged}
              select={select}
              toggle={toggle}
              edit={(rule) => setEditing({ rule })}
              remove={setRemoving}
              history={(rule) =>
                showHistory({
                  id: rule.id,
                  label: `${rule.symbol} · ${describeRule(rule)}`,
                })
              }
            />
            <SectionFoot>
              <span>
                {data?.source ?? "Market data"} · prices in each listing’s quote
                currency
              </span>
              <span>Delivery marks reflect each alert’s latest message</span>
            </SectionFoot>
          </>
        ) : (
          <Empty title="No alerts yet">
            Press <b>New alert</b> to watch a price, a day’s move or the volume
            traded. You can also right-click any chart to set one at the price
            under your cursor.
          </Empty>
        )}
      </section>
      <SignalsPanel
        signals={signals}
        channels={channels}
        latest={latest}
        counts={logged}
        save={save}
        notify={notify}
        monitoring={monitoring && !demo}
        history={(signal) => showHistory({ id: signal.id, label: signal.name })}
      />
      <AlertHistory
        log={log}
        alerts={alerts}
        signals={signals}
        focus={focus}
        setFocus={setFocus}
        select={select}
        reload={reload}
        notify={notify}
      />
      <ChannelsPanel
        demo={demo}
        usage={usage}
        notify={notify}
        setup={setGuide}
        reload={reload}
      />
      {open ? (
        <AlertEditor
          key={open.rule?.id ?? JSON.stringify(open.draft)}
          rule={open.rule}
          draft={open.draft}
          channels={channelData.channels}
          save={save}
          close={closeEditor}
          saved={(rule) =>
            notify(
              `${open.rule ? "Saved" : "Alert set"}: ${rule.symbol} ${describeRule(rule).toLowerCase()}.`,
            )
          }
          setupChannel={demo ? undefined : () => setGuide("email")}
        />
      ) : null}
      {guide ? (
        <ChannelGuide
          kind={guide}
          close={() => setGuide(null)}
          created={(channel) => {
            void refreshChannels();
            notify(`${channel.label} connected. A test message is on its way.`);
          }}
          emailReady={channelData.email.ready}
          defaultEmail={channelData.email.address}
          connect={channelData.connect}
          pushKey={channelData.push.publicKey}
        />
      ) : null}
      {removing ? (
        <RemoveDialog
          item={`the ${removing.symbol} alert`}
          close={() => setRemoving(undefined)}
          remove={() =>
            save((workspace) => ({
              ...workspace,
              alerts: workspace.alerts.filter(
                (item) => item.id !== removing.id,
              ),
            }))
          }
        />
      ) : null}
    </div>
  );
}
