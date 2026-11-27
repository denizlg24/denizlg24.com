"use client";

import { Settings2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  countdown,
  type ExchangeKey,
  exchangeKeys,
  exchangeStatus,
  exchanges,
} from "@/lib/exchanges";
import { SkeletonRows, WidgetFrame, type WidgetProps } from "./frame";

function subscribeMinute(notify: () => void) {
  let interval: ReturnType<typeof setInterval> | undefined;
  const timeout = setTimeout(
    () => {
      notify();
      interval = setInterval(notify, 60_000);
    },
    60_000 - (Date.now() % 60_000) + 50,
  );
  return () => {
    clearTimeout(timeout);
    clearInterval(interval);
  };
}
const minuteSnapshot = () => Math.floor(Date.now() / 60_000) * 60_000;
const serverSnapshot = () => 0;

export function useMinute() {
  return useSyncExternalStore(subscribeMinute, minuteSnapshot, serverSnapshot);
}

const stateLabel = { open: "Open", break: "Lunch", closed: "Closed" } as const;
const regions = ["Americas", "Europe", "Asia-Pacific"] as const;

export function ExchangePicker({
  selected,
  onChange,
}: {
  selected: readonly ExchangeKey[];
  onChange: (next: ExchangeKey[]) => void;
}) {
  return (
    <div className="clock-picker">
      {regions.map((region) => (
        <fieldset key={region}>
          <legend className="kicker">{region}</legend>
          <div>
            {exchangeKeys
              .filter((key) => exchanges[key].region === region)
              .map((key) => {
                const on = selected.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    disabled={on && selected.length === 1}
                    title={`${exchanges[key].city} · ${exchanges[key].zone}`}
                    onClick={() =>
                      onChange(
                        on
                          ? selected.filter((item) => item !== key)
                          : exchangeKeys.filter(
                              (item) => item === key || selected.includes(item),
                            ),
                      )
                    }
                  >
                    {exchanges[key].name}
                  </button>
                );
              })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function ClocksWidget({ widget, ctx }: WidgetProps<"clocks">) {
  const now = useMinute();
  const [configuring, setConfiguring] = useState(false);
  const rows = now
    ? widget.exchanges.map((key) => ({ key, ...exchangeStatus(key, now) }))
    : [];
  const open = rows.filter((row) => row.state === "open").length;
  return (
    <WidgetFrame
      label="Market clocks"
      className="desk-clocks"
      subtitle={now ? `${open} of ${widget.exchanges.length} open` : undefined}
      actions={
        <Button
          variant={configuring ? "secondary" : "ghost"}
          size="icon-xs"
          aria-label="Choose exchanges"
          aria-expanded={configuring}
          title="Choose exchanges"
          onClick={() => setConfiguring(!configuring)}
        >
          <Settings2 />
        </Button>
      }
      foot={
        <>
          <span>Regular sessions, exchange local time</span>
          <span title="Exchange holidays and half days are not accounted for">
            Holidays not included
          </span>
        </>
      }
    >
      {configuring ? (
        <ExchangePicker
          selected={widget.exchanges}
          onChange={(next) => void ctx.update({ ...widget, exchanges: next })}
        />
      ) : null}
      {now ? (
        <table className="data-table clock-table">
          <thead>
            <tr>
              <th>Exchange</th>
              <th>Local</th>
              <th>Status</th>
              <th className="num">Next</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const exchange = exchanges[row.key];
              return (
                <tr key={row.key} data-state={row.state}>
                  <td>
                    <strong>{exchange.name}</strong>
                    <span className="clock-city">{exchange.city}</span>
                  </td>
                  <td className="clock-time">
                    <span>{row.localDay}</span> {row.localTime}
                  </td>
                  <td>
                    <span className="clock-state">
                      <i aria-hidden />
                      {stateLabel[row.state]}
                    </span>
                  </td>
                  <td className="num clock-next">
                    {row.state === "open" ? "Closes" : "Opens"} in{" "}
                    {countdown(row.next - now)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <SkeletonRows rows={widget.exchanges.length} label="Loading clocks" />
      )}
    </WidgetFrame>
  );
}
