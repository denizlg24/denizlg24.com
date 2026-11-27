"use client";

import {
  Bell,
  BellOff,
  FileText,
  LoaderCircle,
  Play,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AlertEvent, Routine } from "@/lib/models";
import type { Channel } from "@/lib/notify/types";
import { describeSchedule, nextSlot, routineStatus } from "@/lib/routines";
import { RemoveDialog, type Save } from "../forms";
import { api, Empty, PanelHeading, SectionFoot } from "../shared";
import { DeliveryRoute } from "./delivery-route";
import { ago, fullTime } from "./format";

const until = (time: number) => {
  const hours = (time - Date.now()) / 3_600_000;
  if (hours < 1) return "within the hour";
  if (hours < 36) return `in ${Math.round(hours)} h`;
  return `in ${Math.round(hours / 24)} days`;
};

export function RoutinesPanel({
  routines,
  channels,
  latest,
  save,
  notify,
  reload,
  monitoring,
  openThread,
}: {
  routines: Routine[];
  channels: Map<string, Channel>;
  latest: Map<string, AlertEvent>;
  save: Save;
  notify: (message: string, error?: boolean) => void;
  reload: () => void;
  monitoring: boolean;
  openThread?: (id: string) => void;
}) {
  const [removing, setRemoving] = useState<Routine>();
  const [showing, setShowing] = useState<string | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());

  const toggle = (item: Routine) =>
    void save((workspace) => ({
      ...workspace,
      routines: workspace.routines.map((entry) =>
        entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry,
      ),
    })).catch((error: Error) => notify(error.message, true));

  async function runNow(item: Routine) {
    setRunning((current) => new Set(current).add(item.id));
    notify(`Running “${item.name}”. This can take a couple of minutes.`);
    try {
      const result = await api<{ threadId: string; credits: number | null }>(
        `/api/routines/${item.id}/run`,
        { method: "POST" },
      );
      notify(
        `“${item.name}” finished${result.credits != null ? ` for ${result.credits.toFixed(1)} credits` : ""}. The answer is saved as a thread.`,
      );
      openThread?.(result.threadId);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "The routine failed.",
        true,
      );
    } finally {
      setRunning((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      reload();
    }
  }

  return (
    <section className="panel signals-panel" aria-labelledby="routines-title">
      <PanelHeading
        title="Routines"
        subtitle={
          monitoring
            ? "Questions the assistant answers on a schedule, saved as a thread and sent where you choose. Ask the assistant to create or change one."
            : "Routines are created by the assistant. Scheduled runs are off in this session; Run now still works."
        }
      />
      {routines.length ? (
        <>
          <div className="alert-rows">
            <div
              className="alert-row signal-row routine-row alert-row-head"
              aria-hidden
            >
              <span className="c-cond">Routine</span>
              <span className="c-now">Next run</span>
              <span className="c-dist">Last run</span>
              <span className="c-route">Delivers to</span>
              <span className="c-last">Answer</span>
              <span className="c-actions" />
            </div>
            <ul>
              {routines.map((item) => {
                const status = routineStatus(item);
                const busy = running.has(item.id);
                const next = item.enabled
                  ? nextSlot(item.schedule, new Date())
                  : null;
                return (
                  <li
                    key={item.id}
                    className="alert-row signal-row routine-row"
                  >
                    <div className="c-cond">
                      <span className="alert-condition-text">
                        <span
                          className="status"
                          data-status={
                            status === "Scheduled"
                              ? "armed"
                              : status === "Failing"
                                ? "errored"
                                : "paused"
                          }
                          title={status}
                        >
                          <span className="sr-only">{status}: </span>
                        </span>
                        {item.name}
                      </span>
                      <span className="alert-detail">
                        <span>{describeSchedule(item.schedule)}</span>
                        {item.lastError ? (
                          <span
                            className="negative alert-note"
                            title={item.lastError}
                          >
                            {item.lastError}
                          </span>
                        ) : item.lastSummary ? (
                          <span className="alert-note" title={item.lastSummary}>
                            {item.lastSummary}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="alert-reading">
                      <span className="c-now num">
                        <span className="narrow-label">Next </span>
                        {next ? (
                          <span title={fullTime(new Date(next).toISOString())}>
                            {until(next)}
                          </span>
                        ) : (
                          "paused"
                        )}
                      </span>
                      <span className="c-dist muted">
                        <span className="narrow-label">Last run </span>
                        {item.lastRun ? (
                          <span title={fullTime(item.lastRun)}>
                            {ago(item.lastRun)}
                            {item.lastCredits != null
                              ? ` · ${item.lastCredits.toFixed(1)} cr`
                              : ""}
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
                        {item.lastThreadId && openThread ? (
                          <button
                            type="button"
                            className="last-fired"
                            onClick={() =>
                              item.lastThreadId && openThread(item.lastThreadId)
                            }
                          >
                            <span className="narrow-label">Answer </span>
                            Open
                            {item.runCount > 1 ? (
                              <span className="last-fired-sub">
                                {item.runCount} runs in total
                              </span>
                            ) : null}
                          </button>
                        ) : (
                          <span className="muted">
                            <span className="narrow-label">Answer </span>none
                            yet
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="c-actions row-actions row-actions-end">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Run now"
                        title="Run now"
                        disabled={busy}
                        onClick={() => void runNow(item)}
                      >
                        {busy ? (
                          <LoaderCircle className="motion-safe:animate-spin" />
                        ) : (
                          <Play />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={
                          item.enabled ? "Pause routine" : "Resume routine"
                        }
                        title={item.enabled ? "Pause" : "Resume"}
                        onClick={() => toggle(item)}
                      >
                        {item.enabled ? <BellOff /> : <Bell />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Show prompt"
                        aria-expanded={showing === item.id}
                        title="Show prompt"
                        onClick={() =>
                          setShowing(showing === item.id ? null : item.id)
                        }
                      >
                        <FileText />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Delete routine"
                        title="Delete"
                        onClick={() => setRemoving(item)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {showing === item.id ? (
                      <pre className="signal-code routine-prompt">
                        {item.prompt}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
          <SectionFoot>
            <span>Each run uses credits</span>
            <span>
              {routines.filter((item) => item.enabled).length} of{" "}
              {routines.length} scheduled
            </span>
          </SectionFoot>
        </>
      ) : (
        <Empty title="No routines yet">
          Ask the assistant for something on a schedule, such as “on the 1st of
          every month, tell me which of my ETFs to buy with my €500”.
        </Empty>
      )}
      {removing ? (
        <RemoveDialog
          item={`the ${removing.name} routine`}
          close={() => setRemoving(undefined)}
          remove={() =>
            save((workspace) => ({
              ...workspace,
              routines: workspace.routines.filter(
                (item) => item.id !== removing.id,
              ),
            }))
          }
        />
      ) : null}
    </section>
  );
}
