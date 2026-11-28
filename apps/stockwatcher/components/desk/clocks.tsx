"use client";

import { Settings2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { type ClockStyle, clockStyles } from "@/lib/desk";
import {
  countdown,
  type ExchangeKey,
  type ExchangeStatus,
  exchangeKeys,
  exchangeStatus,
  exchanges,
  localClock,
  sessionSpans,
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

const styleLabels: Record<ClockStyle, string> = {
  table: "Table",
  dials: "Dials",
  timeline: "Timeline",
  strip: "Strip",
};

type Row = ExchangeStatus & { key: ExchangeKey };

const nextLabel = (row: Row, now: number) =>
  `${row.state === "open" ? "Closes" : "Opens"} in ${countdown(row.next - now)}`;

function StateMark({ state }: { state: Row["state"] }) {
  return (
    <span className="clock-state">
      <i aria-hidden />
      {stateLabel[state]}
    </span>
  );
}

function ClockTable({ rows, now }: { rows: Row[]; now: number }) {
  return (
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
                <StateMark state={row.state} />
              </td>
              <td className="num clock-next">{nextLabel(row, now)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const DIAL = 32;
const polar = (degrees: number, radius: number) => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [
    DIAL + radius * Math.cos(radians),
    DIAL + radius * Math.sin(radians),
  ] as const;
};
const minuteAngle = (minutes: number) => ((minutes % 720) / 720) * 360;

function sessionArc(open: number, close: number, radius: number) {
  const from = minuteAngle(open);
  const sweep = ((close - open) / 720) * 360;
  const [x1, y1] = polar(from, radius);
  const [x2, y2] = polar(from + sweep, radius);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function Dial({ row, now }: { row: Row; now: number }) {
  const exchange = exchanges[row.key];
  const { hour, minute } = localClock(row.key, now);
  const hourAngle = minuteAngle(hour * 60 + minute);
  const [hx, hy] = polar(hourAngle, 15);
  const [mx, my] = polar((minute / 60) * 360, 22);
  return (
    <li className="clock-dial" data-state={row.state}>
      <svg
        viewBox="0 0 64 64"
        role="img"
        aria-label={`${exchange.name} ${row.localTime}, ${stateLabel[row.state].toLowerCase()}`}
      >
        <circle className="dial-face" cx={DIAL} cy={DIAL} r={30} />
        {Array.from({ length: 12 }, (_, index) => {
          const [x1, y1] = polar(index * 30, index % 3 ? 27 : 25);
          const [x2, y2] = polar(index * 30, 29);
          return (
            <line
              key={index}
              className="dial-tick"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            />
          );
        })}
        {exchange.sessions.map(([open, close]) => (
          <path
            key={open}
            className="dial-session"
            d={sessionArc(open, close, 30)}
          />
        ))}
        <line className="dial-hour" x1={DIAL} y1={DIAL} x2={hx} y2={hy} />
        <line className="dial-minute" x1={DIAL} y1={DIAL} x2={mx} y2={my} />
        <circle className="dial-hub" cx={DIAL} cy={DIAL} r={1.8} />
      </svg>
      <div className="clock-dial-text">
        <strong>{exchange.name}</strong>
        <span className="clock-time">
          <span>{row.localDay}</span> {row.localTime}
        </span>
        <StateMark state={row.state} />
        <span className="clock-next">{nextLabel(row, now)}</span>
      </div>
    </li>
  );
}

function ClockDials({ rows, now }: { rows: Row[]; now: number }) {
  return (
    <ul className="clock-dials">
      {rows.map((row) => (
        <Dial key={row.key} row={row} now={now} />
      ))}
    </ul>
  );
}

const hourMs = 3_600_000;
const utcTime = (ms: number) => new Date(ms).toISOString().slice(11, 16);

function ClockTimeline({ rows, now }: { rows: Row[]; now: number }) {
  const from = Math.floor(now / (24 * hourMs)) * 24 * hourMs;
  const at = (ms: number) =>
    `${(((ms - from) / (24 * hourMs)) * 100).toFixed(3)}%`;
  const nowAt = at(now);
  const nowShare = (now - from) / (24 * hourMs);
  return (
    <div className="clock-timeline">
      <div className="clock-timeline-axis" aria-hidden>
        <span className="clock-timeline-label">UTC</span>
        <div className="clock-timeline-scale">
          {[0, 6, 12, 18]
            .filter((hour) => Math.abs(hour / 24 - nowShare) > 0.07)
            .map((hour) => (
              <span
                key={hour}
                className={hour ? undefined : "clock-timeline-start"}
                style={{ left: `${(hour / 24) * 100}%` }}
              >
                {String(hour).padStart(2, "0")}
              </span>
            ))}
          <span className="clock-timeline-now-label" style={{ left: nowAt }}>
            {utcTime(now)}
          </span>
        </div>
      </div>
      <ul>
        {rows.map((row) => {
          const exchange = exchanges[row.key];
          const spans = sessionSpans(row.key, from);
          return (
            <li key={row.key} data-state={row.state}>
              <div className="clock-timeline-label">
                <strong>{exchange.name}</strong>
                <span className="clock-time">{row.localTime}</span>
              </div>
              <div
                className="clock-timeline-band"
                role="img"
                aria-label={`${exchange.name}: ${
                  spans
                    .filter((item) => item.kind === "session")
                    .map(
                      (item) => `${utcTime(item.start)}–${utcTime(item.end)}`,
                    )
                    .join(", ") || "no session"
                } UTC today. ${stateLabel[row.state]}, ${nextLabel(row, now).toLowerCase()}.`}
              >
                {[6, 12, 18].map((hour) => (
                  <i
                    key={hour}
                    className="clock-timeline-grid"
                    style={{ left: `${(hour / 24) * 100}%` }}
                  />
                ))}
                {spans.map((item) => (
                  <span
                    key={item.start}
                    className="clock-timeline-span"
                    data-kind={item.kind}
                    data-when={
                      item.end <= now
                        ? "past"
                        : item.start <= now
                          ? "live"
                          : "later"
                    }
                    style={{
                      left: at(item.start),
                      width: `${(((item.end - item.start) / (24 * hourMs)) * 100).toFixed(3)}%`,
                    }}
                  />
                ))}
                {spans.length ? null : (
                  <span className="clock-timeline-empty" aria-hidden>
                    No session today · opens in {countdown(row.next - now)}
                  </span>
                )}
                <i className="clock-timeline-now" style={{ left: nowAt }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ClockStrip({ rows, now }: { rows: Row[]; now: number }) {
  return (
    <ul className="clock-strip">
      {rows.map((row) => {
        const exchange = exchanges[row.key];
        return (
          <li
            key={row.key}
            data-state={row.state}
            title={`${exchange.name} · ${exchange.city} ${row.localTime} · ${nextLabel(row, now)}`}
          >
            <span className="clock-state">
              <i aria-hidden />
              <span className="sr-only">{stateLabel[row.state]}</span>
            </span>
            <strong>{exchange.name}</strong>
            <span className="clock-next">
              <small>{row.state === "open" ? "closes" : "opens"}</small>{" "}
              {countdown(row.next - now)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function ClocksWidget({ widget, ctx }: WidgetProps<"clocks">) {
  const now = useMinute();
  const [configuring, setConfiguring] = useState(false);
  const rows: Row[] = now
    ? widget.exchanges.map((key) => ({ key, ...exchangeStatus(key, now) }))
    : [];
  const open = rows.filter((row) => row.state === "open").length;
  const style = widget.style;
  return (
    <WidgetFrame
      label="Market clocks"
      className="desk-clocks"
      subtitle={now ? `${open} of ${widget.exchanges.length} open` : undefined}
      actions={
        <Button
          variant={configuring ? "secondary" : "ghost"}
          size="icon-xs"
          aria-label="Clock settings"
          aria-expanded={configuring}
          title="Clock settings"
          onClick={() => setConfiguring(!configuring)}
        >
          <Settings2 />
        </Button>
      }
      foot={
        <>
          <span>
            {style === "timeline"
              ? "Today in UTC · regular sessions and lunch breaks"
              : "Regular sessions, exchange local time"}
          </span>
          <span title="Exchange holidays and half days are not accounted for">
            Holidays not included
          </span>
        </>
      }
    >
      {configuring ? (
        <div className="clock-config">
          <div className="clock-config-style">
            <span className="kicker">Style</span>
            <div className="seg" role="group" aria-label="Clock style">
              {clockStyles.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={style === key}
                  onClick={() => void ctx.update({ ...widget, style: key })}
                >
                  {styleLabels[key]}
                </button>
              ))}
            </div>
          </div>
          <ExchangePicker
            selected={widget.exchanges}
            onChange={(next) => void ctx.update({ ...widget, exchanges: next })}
          />
        </div>
      ) : null}
      {!now ? (
        <SkeletonRows rows={widget.exchanges.length} label="Loading clocks" />
      ) : style === "dials" ? (
        <ClockDials rows={rows} now={now} />
      ) : style === "timeline" ? (
        <ClockTimeline rows={rows} now={now} />
      ) : style === "strip" ? (
        <ClockStrip rows={rows} now={now} />
      ) : (
        <ClockTable rows={rows} now={now} />
      )}
    </WidgetFrame>
  );
}
