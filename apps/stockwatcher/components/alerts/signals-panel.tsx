"use client";

import { Bell, BellOff, BellRing, Code2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Signal } from "@/lib/models";
import type { Channel } from "@/lib/notify/types";
import { cadenceLabels, signalStatus } from "@/lib/signals";
import { cn, marketTime } from "@/lib/utils";
import { RemoveDialog, type Save } from "../forms";
import { Empty, PanelHeading, SectionFoot } from "../shared";
import { channelMeta } from "./channel-guide";

const checked = (iso: string | null) =>
  iso ? marketTime(Date.parse(iso) / 1000) : "Not yet";

export function SignalsPanel({
  signals,
  channels,
  save,
  notify,
  monitoring,
}: {
  signals: Signal[];
  channels: Channel[];
  save: Save;
  notify: (message: string, error?: boolean) => void;
  monitoring: boolean;
}) {
  const [removing, setRemoving] = useState<Signal>();
  const [showing, setShowing] = useState<string | null>(null);
  const byId = new Map(channels.map((item) => [item.id, item]));
  const toggle = (item: Signal) =>
    void save((workspace) => ({
      ...workspace,
      signals: workspace.signals.map((entry) =>
        entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry,
      ),
    })).catch((error: Error) => notify(error.message, true));

  return (
    <section className="panel alerts-panel" aria-labelledby="signals-title">
      <PanelHeading
        title="Signals"
        subtitle={
          monitoring
            ? "Saved calculations that alert you when they come true. Ask the assistant to create or change one."
            : "Signals are created by the assistant. Background checks are disabled in this session."
        }
      />
      {signals.length ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Signal</TableHead>
                <TableHead className="text-right col-mid">Value</TableHead>
                <TableHead className="col-mid">Checked</TableHead>
                <TableHead className="col-mid">Notify</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="col-wide">Last fired</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signals.map((item) => {
                const status = signalStatus(item);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="alert-rule-cell">
                      <span className="strong-cell">{item.name}</span>
                      <span className="alert-rule-meta muted">
                        <span>{cadenceLabels[item.cadence]}</span>
                        {item.repeat === "rearm" ? (
                          <span>every crossing</span>
                        ) : null}
                        {item.lastMessage ? (
                          <span className="alert-note" title={item.lastMessage}>
                            {item.lastMessage}
                          </span>
                        ) : null}
                        {item.lastError ? (
                          <span className="negative" title={item.lastError}>
                            {item.lastError.slice(0, 80)}
                          </span>
                        ) : null}
                      </span>
                      {showing === item.id ? (
                        <pre className="alert-note">{item.code}</pre>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right col-mid">
                      {item.lastValue != null
                        ? Number(item.lastValue.toPrecision(6))
                        : "—"}
                    </TableCell>
                    <TableCell className="muted col-mid">
                      {checked(item.lastChecked)}
                    </TableCell>
                    <TableCell className="col-mid">
                      <span className="alert-route">
                        <BellRing size={13} aria-label="In app" />
                        {item.channels.map((id) => {
                          const channel = byId.get(id);
                          if (!channel) return null;
                          const Icon = channelMeta[channel.kind].icon;
                          return (
                            <Icon
                              key={id}
                              size={13}
                              aria-label={channel.label}
                              className={cn(
                                channel.status === "error" && "negative",
                              )}
                            />
                          );
                        })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className="status"
                        data-status={status.toLowerCase().split(" ")[0]}
                      >
                        {status}
                      </span>
                    </TableCell>
                    <TableCell className="muted col-wide">
                      {item.lastTriggered
                        ? `${marketTime(Date.parse(item.lastTriggered) / 1000)}${item.triggerCount > 1 ? ` · ${item.triggerCount}×` : ""}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="row-actions row-actions-end">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={
                            item.enabled ? "Pause signal" : "Arm signal"
                          }
                          onClick={() => toggle(item)}
                        >
                          {item.enabled ? <BellOff /> : <Bell />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Show code"
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
                          onClick={() => setRemoving(item)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
