"use client";

import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { api, Empty, Failure, Loading } from "@/components/shared";
import type { EarningsEvent } from "@/lib/calendar";
import type { Workspace } from "@/lib/models";
import type { SecurityFunction } from "@/lib/terminal";
import { amount, compact } from "@/lib/utils";

type Calendar = {
  dates: string[];
  events: EarningsEvent[];
  failed: string[];
  fomc: string[];
};
const caps: [number, string][] = [
  [0, "Any cap"],
  [2e9, "≥ $2B"],
  [10e9, "≥ $10B"],
  [50e9, "≥ $50B"],
  [200e9, "≥ $200B"],
];

function monday(offsetWeeks: number) {
  const date = new Date();
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day + offsetWeeks * 7);
  return date.toISOString().slice(0, 10);
}
const dayName = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${iso}T12:00:00Z`));

export function EarningsCalendar({
  watchlists,
  trades,
  open,
}: {
  watchlists: Workspace["watchlists"];
  trades: Workspace["trades"];
  open: (symbol: string, fn: SecurityFunction) => void;
}) {
  const [week, setWeek] = useState(0);
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [cap, setCap] = useState(10e9);
  const [query, setQuery] = useState("");
  const from = monday(week);
  const { data, error, isLoading, mutate } = useSWR<Calendar>(
    `/api/calendar?${new URLSearchParams({ from, days: "5" })}`,
    api,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  const mine = useMemo(
    () =>
      new Set([
        ...watchlists.flatMap((list) => list.symbols),
        ...trades.map((trade) => trade.symbol),
      ]),
    [watchlists, trades],
  );
  const needle = query.trim().toLowerCase();
  const events = (data?.events ?? []).filter(
    (event) =>
      (scope === "all" || mine.has(event.symbol)) &&
      (scope === "mine" || (event.marketCap ?? 0) >= cap) &&
      (!needle ||
        event.symbol.toLowerCase().includes(needle) ||
        event.name.toLowerCase().includes(needle)),
  );
  const fomc = (data?.fomc ?? [])
    .filter((date) => date >= new Date().toISOString().slice(0, 10))
    .slice(0, 3);

  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="row-actions">
          <button
            type="button"
            className="chip"
            aria-label="Previous week"
            onClick={() => setWeek(week - 1)}
          >
            <ChevronLeft size={13} />
          </button>
          <strong className="evts-week">Week of {dayName(from)}</strong>
          <button
            type="button"
            className="chip"
            aria-label="Next week"
            onClick={() => setWeek(week + 1)}
          >
            <ChevronRight size={13} />
          </button>
          {week ? (
            <button type="button" className="chip" onClick={() => setWeek(0)}>
              This week
            </button>
          ) : null}
          <div className="seg" role="group" aria-label="Companies">
            <button
              type="button"
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              All US
            </button>
            <button
              type="button"
              aria-pressed={scope === "mine"}
              onClick={() => setScope("mine")}
              title="Watchlists and positions"
            >
              My symbols
            </button>
          </div>
          {scope === "all" ? (
            <select
              className="studio-select"
              value={cap}
              aria-label="Minimum market cap"
              onChange={(event) => setCap(Number(event.target.value))}
            >
              {caps.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : null}
          <input
            className="studio-select"
            placeholder="Filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter companies"
          />
        </div>
        <span className="term-source">{events.length} reports</span>
      </div>
      {fomc.length ? (
        <p className="evts-fomc">
          <b>FOMC decisions</b> {fomc.map(dayName).join(" · ")}{" "}
          <a
            href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
            target="_blank"
            rel="noreferrer"
          >
            Fed calendar <ExternalLink size={11} aria-hidden />
          </a>
        </p>
      ) : null}
      <Failure error={error} retry={() => void mutate()} />
      {isLoading && !data ? (
        <Loading message="Loading earnings calendar" />
      ) : (
        <div className="evts-grid">
          {(data?.dates ?? []).map((date) => {
            const today = events
              .filter((event) => event.date === date)
              .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
            return (
              <section
                key={date}
                className="evts-day"
                data-today={
                  date === new Date().toISOString().slice(0, 10) || undefined
                }
              >
                <h3>
                  {dayName(date)}
                  <small>{today.length}</small>
                  {data?.fomc.includes(date) ? (
                    <span className="evts-tag">FOMC</span>
                  ) : null}
                </h3>
                {data?.failed.includes(date) ? (
                  <p className="muted">Unavailable</p>
                ) : today.length ? (
                  <ul>
                    {today.slice(0, 60).map((event) => (
                      <li
                        key={event.symbol}
                        data-mine={mine.has(event.symbol) || undefined}
                      >
                        <button
                          type="button"
                          className="security-link"
                          onClick={() => open(event.symbol, "ERN")}
                          title={`${event.name} · ${event.quarter ?? ""}`}
                        >
                          {event.symbol}
                        </button>
                        <span className="evts-time" data-time={event.time}>
                          {event.time === "before"
                            ? "BMO"
                            : event.time === "after"
                              ? "AMC"
                              : "—"}
                        </span>
                        <span className="evts-name">{event.name}</span>
                        <span
                          className="evts-num"
                          title="EPS forecast · last year"
                        >
                          {amount(event.epsForecast)}
                          <small> / {amount(event.lastYearEps)}</small>
                        </span>
                        <span className="evts-num muted">
                          {compact(event.marketCap)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="No reports" />
                )}
              </section>
            );
          })}
        </div>
      )}
      <p className="term-source">
        US earnings dates from Nasdaq. BMO = before the open, AMC = after the
        close. EPS shows the consensus forecast and last year&apos;s figure.
        Click a ticker for its ERN page.
      </p>
    </div>
  );
}
