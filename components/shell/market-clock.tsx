"use client";

import { useSyncExternalStore } from "react";

const exchanges = [
  { name: "NYSE", zone: "America/New_York", open: 570, close: 960 },
  { name: "LSE", zone: "Europe/London", open: 480, close: 990 },
  { name: "Xetra", zone: "Europe/Berlin", open: 540, close: 1050 },
] as const;

const parts = new Map(
  exchanges.map((exchange) => [
    exchange.zone,
    new Intl.DateTimeFormat("en-US", {
      timeZone: exchange.zone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
  ]),
);
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

function isOpen(exchange: (typeof exchanges)[number], now: Date) {
  const formatter = parts.get(exchange.zone);
  if (!formatter) return false;
  const values = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  if (values.weekday === "Sat" || values.weekday === "Sun") return false;
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  return minutes >= exchange.open && minutes < exchange.close;
}

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 20_000);
  return () => clearInterval(timer);
}

const minuteKey = () => String(Math.floor(Date.now() / 60_000));
const serverKey = () => "";

export function MarketClock() {
  const key = useSyncExternalStore(subscribe, minuteKey, serverKey);
  if (!key) return <div className="market-clock" aria-hidden />;
  const now = new Date(Number(key) * 60_000);
  return (
    <div
      className="market-clock"
      title="Regular trading hours; exchange holidays are not accounted for"
    >
      <span className="market-clock-date">
        {dayFormat.format(now)} <b>{timeFormat.format(now)}</b>
      </span>
      <ul aria-label="Exchange status">
        {exchanges.map((exchange) => {
          const open = isOpen(exchange, now);
          return (
            <li key={exchange.name} data-open={open || undefined}>
              <i aria-hidden />
              {exchange.name}
              <span className="sr-only">{open ? " open" : " closed"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
