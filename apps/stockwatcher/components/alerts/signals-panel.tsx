"use client";

import { Bell, BellOff, Code2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AlertEvent, Signal } from "@/lib/models";
import type { Channel } from "@/lib/notify/types";
import { cadenceLabels, signalStatus } from "@/lib/signals";
import { RemoveDialog, type Save } from "../forms";
import { Empty, PanelHeading, SectionFoot } from "../shared";
import { DeliveryRoute } from "./delivery-route";
import { ago, fullTime } from "./format";

export function SignalsPanel({
  signals,
  channels,
  latest,
  counts,
  save,
  notify,
  monitoring,
  history,
}: {
  signals: Signal[];
  channels: Map<string, Channel>;
  latest: Map<string, AlertEvent>;
  counts: Map<string, number>;
  save: Save;
  notify: (message: string, error?: boolean) => void;
  monitoring: boolean;
  history: (signal: Signal) => void;
}) {
  const [removing, setRemoving] = useState<Signal>();
  const [showing, setShowing] = useState<string | null>(null);
  const toggle = (item: Signal) =>
    void save((workspace) => ({
      ...workspace,
      signals: workspace.signals.map((entry) =>
        entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry,
      ),
    })).catch((error: Error) => notify(error.message, true));

  return (
    <section className="panel signals-panel" aria-labelledby="signals-title">
      <PanelHeading
        title="Signals"
        subtitle={
          monitoring
            ? "Saved calculations that alert you when they come true. Ask the assistant to create or change one."
            : "Signals are created by the assistant. Background checks are off in this session."
        }
      />
      {signals.length ? (
        <>
          <div className="alert-rows">
            <div className="alert-row signal-row alert-row-head" aria-hidden>
              <span className="c-cond">Signal</span>
              <span className="c-now">Last value</span>
              <span className="c-dist">Checked</span>
              <span className="c-route">Delivers to</span>
              <span className="c-last">Last fired</span>
              <span className="c-actions" />
            </div>
            <ul>
              {signals.map((item) => {
                const status = signalStatus(item);
                const logged = counts.get(item.id) ?? 0;
                return (
                  <li key={item.id} className="alert-row signal-row">
                    <div className="c-cond">
                      <span className="alert-condition-text">
                        <span
                          className="status"
                          data-status={status.toLowerCase().split(" ")[0]}
                          title={status}
                        >
                          <span className="sr-only">{status}: </span>
                        </span>
                        {item.name}
                      </span>
                      <span className="alert-detail">
                        <span>{cadenceLabels[item.cadence]}</span>
                        {item.repeat === "rearm" ? (
                          <span>Every crossing</span>
                        ) : null}
                        {item.lastError ? (
                          <span
                            className="negative alert-note"
                            title={item.lastError}
                          >
                            {item.lastError}
                          </span>
                        ) : item.lastMessage ? (
                          <span className="alert-note" title={item.lastMessage}>
                            {item.lastMessage}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="alert-reading">
                      <span className="c-now num">
                        <span className="narrow-label">Value </span>
                        {item.lastValue != null
                          ? Number(item.lastValue.toPrecision(6))
                          : "—"}
                      </span>
                      <span className="c-dist muted">
                        <span className="narrow-label">Checked </span>
                        {item.lastChecked ? (
                          <span title={fullTime(item.lastChecked)}>
                            {ago(item.lastChecked)}
                          </span>
                        ) : (
                          "not yet"
                        )}
                      </span>
                    </div>
                    <div className="alert-meta">
                      <div className="c-route">
                        <DeliveryRoute
                          ids={item.channels}
                          channels={channels}
                          last={latest.get(item.id)}
                        />
                      </div>
                      <div className="c-last">
                        {item.lastTriggered ? (
                          <button
                            type="button"
                            className="last-fired"
                            title={`${fullTime(item.lastTriggered)} · show in history`}
                            disabled={!logged}
                            onClick={() => history(item)}
                          >
                            <span className="narrow-label">Fired </span>
                            {ago(item.lastTriggered)}
                            {item.triggerCount > 1 ? (
                              <span className="last-fired-sub">
                                {item.triggerCount}× in total
                              </span>
                            ) : null}
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
                        aria-label={
                          item.enabled ? "Pause signal" : "Arm signal"
                        }
                        title={item.enabled ? "Pause" : "Arm again"}
                        onClick={() => toggle(item)}
                      >
                        {item.enabled ? <BellOff /> : <Bell />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Show code"
                        aria-expanded={showing === item.id}
                        title="Show code"
                        onClick={() =>
                          setShowing(showing === item.id ? null : item.id)
                        }
                      >
                        <Code2 />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Delete signal"
                        title="Delete"
                        onClick={() => setRemoving(item)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {showing === item.id ? (
                      <pre className="signal-code">{item.code}</pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
          <SectionFoot>
            <span>Yahoo Finance / Moscow Exchange</span>
            <span>
              {signals.filter((item) => item.enabled).length} of{" "}
              {signals.length} armed
            </span>
          </SectionFoot>
        </>
      ) : (
        <Empty title="No signals yet">
          Ask the assistant for an alert on a calculation, such as “tell me when
          S&amp;P 500 breadth falls below 40%”.
        </Empty>
      )}
      {removing ? (
        <RemoveDialog
          item={`the ${removing.name} signal`}
          close={() => setRemoving(undefined)}
          remove={() =>
            save((workspace) => ({
              ...workspace,
              signals: workspace.signals.filter(
                (item) => item.id !== removing.id,
              ),
            }))
          }
        />
      ) : null}
    </section>
  );
}
