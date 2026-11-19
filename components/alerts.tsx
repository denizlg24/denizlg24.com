"use client";

import { useState } from "react";
import { Bell, BellOff, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field, FormDialog, RemoveDialog, value, type Save } from "./forms";
import { Empty, PanelHeading, SectionFoot, SymbolLink, Tick } from "./shared";
import { symbolSchema, type Workspace } from "@/lib/models";
import { useQuotes } from "./market-widgets";
import { amount, marketTime, percent } from "@/lib/utils";

type Rule = Workspace["alerts"][number];

export function Alerts({
  alerts,
  ticker,
  save,
  refresh,
  demo,
  monitoring,
  select,
  proposed,
  clearProposed,
  notify,
}: {
  alerts: Rule[];
  ticker: string;
  save: Save;
  refresh: boolean;
  demo: boolean;
  monitoring: boolean;
  select: (ticker: string) => void;
  proposed: {
    symbol: string;
    direction: Rule["direction"];
    target: number;
  } | null;
  clearProposed: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [modal, setModal] = useState<"new" | "edit" | "delete" | null>(null);
  const [rule, setRule] = useState<Rule>();
  const { data } = useQuotes(
    alerts.map((item) => item.symbol),
    refresh,
  );
  const quotes = new Map(data?.quotes.map((item) => [item.symbol, item]));
  const close = () => {
    setModal(null);
    setRule(undefined);
    clearProposed();
  };
  return (
    <section className="panel alerts-panel">
      <PanelHeading
        title="Price alerts"
        subtitle={
          demo || !monitoring
            ? "Alerts can be configured here. Background checks are disabled in this session."
            : "Thresholds are checked every two minutes. Alerts are recorded here."
        }
      >
        <Button
          size="sm"
          onClick={() => {
            setRule(undefined);
            setModal("new");
          }}
        >
          <Plus /> New alert
        </Button>
      </PanelHeading>
      {alerts.length ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="col-mid">Condition</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-right col-mid">Last</TableHead>
                <TableHead className="text-right">To target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="col-wide">Last triggered</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((item) => {
                const quote = quotes.get(item.symbol);
                const distance = quote?.price
                  ? (item.target / quote.price - 1) * 100
                  : null;
                const status = item.enabled
                  ? "Armed"
                  : item.lastTriggered
                    ? "Triggered"
                    : "Paused";
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <SymbolLink
                        symbol={item.symbol}
                        select={select}
                        label={quote?.name}
                      />
                    </TableCell>
                    <TableCell className="muted col-mid">
                      {item.direction === "above"
                        ? "At or above"
                        : "At or below"}
                    </TableCell>
                    <TableCell className="text-right strong-cell">
                      <span
                        className="muted alert-direction"
                        aria-label={
                          item.direction === "above"
                            ? "at or above"
                            : "at or below"
                        }
                      >
                        {item.direction === "above" ? "≥" : "≤"}
                      </span>{" "}
                      {amount(item.target)}{" "}
                      <small className="muted">{quote?.currency}</small>
                    </TableCell>
                    <TableCell className="text-right col-mid">
                      <Tick value={quote?.price} />
                    </TableCell>
                    <TableCell className="text-right muted">
                      {percent(distance)}
                    </TableCell>
                    <TableCell>
                      <span
                        className="status"
                        data-status={status.toLowerCase()}
                      >
                        {status}
                      </span>
                    </TableCell>
                    <TableCell className="muted col-wide">
                      {item.lastTriggered
                        ? `${marketTime(Date.parse(item.lastTriggered) / 1000)} · ${amount(item.triggeredPrice)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="row-actions row-actions-end">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={
                            item.enabled ? "Pause alert" : "Arm alert"
                          }
                          onClick={() =>
                            void save((workspace) => ({
                              ...workspace,
                              alerts: workspace.alerts.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, enabled: !entry.enabled }
                                  : entry,
                              ),
                            })).catch((error: Error) =>
                              notify(error.message, true),
                            )
                          }
                        >
                          {item.enabled ? <BellOff /> : <Bell />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Edit alert"
                          onClick={() => {
                            setRule(item);
                            setModal("edit");
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Delete alert"
                          onClick={() => {
                            setRule(item);
                            setModal("delete");
                          }}
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
            <span>
              {data?.source ?? "Market data"} · targets in each listing’s quote
              currency
            </span>
            <span>
              {alerts.filter((item) => item.enabled).length} of {alerts.length}{" "}
              armed
            </span>
          </SectionFoot>
        </>
      ) : (
        <Empty title="No price alerts">
          Add a target to track when a symbol reaches a price.
        </Empty>
      )}
      {modal === "new" || modal === "edit" || proposed ? (
        <FormDialog
          title={rule ? "Edit price alert" : "New price alert"}
          description="Use the ticker’s quote currency. Each alert triggers once and can be armed again."
          close={close}
          submit={async (fields) => {
            const symbol = symbolSchema.parse(value(fields, "symbol"));
            const target = Number(value(fields, "target"));
            const direction =
              value(fields, "direction") === "below" ? "below" : "above";
            if (!(target > 0)) throw new Error("Enter a positive threshold.");
            const updated: Rule = {
              id: rule?.id ?? crypto.randomUUID(),
              symbol,
              direction,
              target,
              enabled: true,
              lastTriggered: null,
              triggeredPrice: null,
            };
            await save((workspace) => ({
              ...workspace,
              alerts: rule
                ? workspace.alerts.map((item) =>
                    item.id === rule.id ? updated : item,
                  )
                : [updated, ...workspace.alerts],
            }));
          }}
        >
          <Field label="Ticker">
            <Input
              name="symbol"
              defaultValue={rule?.symbol ?? proposed?.symbol ?? ticker}
              required
              maxLength={20}
            />
          </Field>
          <Field label="Direction">
            <select
              name="direction"
              defaultValue={rule?.direction ?? proposed?.direction}
            >
              <option value="above">At or above</option>
              <option value="below">At or below</option>
            </select>
          </Field>
          <Field label="Target price">
            <Input
              name="target"
              type="number"
              min=".00000001"
              max="1000000000000"
              step="any"
              defaultValue={rule?.target ?? proposed?.target}
              required
            />
          </Field>
        </FormDialog>
      ) : null}
      {modal === "delete" && rule ? (
        <RemoveDialog
          item={`the ${rule.symbol} alert`}
          close={close}
          remove={() =>
            save((workspace) => ({
              ...workspace,
              alerts: workspace.alerts.filter((item) => item.id !== rule.id),
            }))
          }
        />
      ) : null}
    </section>
  );
}
