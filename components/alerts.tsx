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
import { Empty, PanelHeading } from "./shared";
import { symbolSchema, type Workspace } from "@/lib/models";
import { useQuotes } from "./market-widgets";
import { amount, marketTime } from "@/lib/utils";

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
    <section className="panel">
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Threshold</TableHead>
              <TableHead className="text-right">Last quote</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last triggered</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.map((item) => {
              const quote = quotes.get(item.symbol);
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => select(item.symbol)}
                    >
                      {item.symbol}
                    </Button>
                  </TableCell>
                  <TableCell>
                    {item.direction === "above" ? "At or above" : "At or below"}{" "}
                    {amount(item.target)} {quote?.currency}
                  </TableCell>
                  <TableCell className="text-right">
                    {amount(quote?.price)} {quote?.currency}
                  </TableCell>
                  <TableCell>
                    {item.enabled
                      ? "Armed"
                      : item.lastTriggered
                        ? "Triggered"
                        : "Paused"}
                  </TableCell>
                  <TableCell>
                    {item.lastTriggered
                      ? `${marketTime(Date.parse(item.lastTriggered) / 1000)} · ${amount(item.triggeredPrice)}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="row-actions">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={item.enabled ? "Pause alert" : "Arm alert"}
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
                        size="icon-sm"
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
                        size="icon-sm"
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
