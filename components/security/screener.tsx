"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  lookbackKeys,
  screenLookbacks,
  type Lookback,
  type Range,
  type Screen,
} from "@/lib/screens";
import constituents from "@/data/sp500.json";
import {
  api,
  Change,
  Empty,
  Failure,
  Loading,
  SortHead,
  useSort,
} from "@/components/shared";
import type { Quote } from "@/lib/models";
import { downloadCsv } from "@/lib/export";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { amount, compact } from "@/lib/utils";

type Row = {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  day: number | null;
  period: number | null;
  position: number | null;
  turnover: number | null;
  cap: number | null;
};

const lookbacks = screenLookbacks;
const sectors = [...new Set(constituents.map((item) => item.sector))].sort();
const sectorOf = new Map(constituents.map((item) => [item.symbol, item]));
const empty: Range = ["", ""];
const blank: Screen = {
  name: "",
  sectors: [],
  query: "",
  price: empty,
  day: empty,
  period: empty,
  position: empty,
  turnover: "",
  lookback: "YTD",
};
const builtIns: Screen[] = [
  { ...blank, name: "Near 52-week highs", position: ["95", ""] },
  { ...blank, name: "Near 52-week lows", position: ["", "5"] },
  { ...blank, name: "Today's big movers", day: ["3", ""] },
  { ...blank, name: "Today's big decliners", day: ["", "-3"] },
  { ...blank, name: "YTD laggards", period: ["", "-15"] },
  { ...blank, name: "Liquid momentum", period: ["20", ""], turnover: "1000000000" },
];

function sinceDate(lookback: Lookback) {
  const date = new Date();
  if (lookback === "YTD") return `${date.getFullYear()}-01-01`;
  date.setDate(date.getDate() - lookbacks[lookback]);
  return date.toISOString().slice(0, 10);
}

const within = (value: number | null, [lo, hi]: Range) => {
  if (lo === "" && hi === "") return true;
  if (value == null) return false;
  if (lo !== "" && value < Number(lo)) return false;
  if (hi !== "" && value > Number(hi)) return false;
  return true;
};


function RangeField({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: Range;
  onChange: (next: Range) => void;
  unit?: string;
}) {
  return (
    <fieldset className="eqs-range">
      <legend>
        {label}
        {unit ? <small> {unit}</small> : null}
      </legend>
      <input
        className="studio-select"
        inputMode="decimal"
        placeholder="min"
        value={value[0]}
        aria-label={`${label} minimum`}
        onChange={(event) => onChange([event.target.value, value[1]])}
      />
      <input
        className="studio-select"
        inputMode="decimal"
        placeholder="max"
        value={value[1]}
        aria-label={`${label} maximum`}
        onChange={(event) => onChange([value[0], event.target.value])}
      />
    </fieldset>
  );
}

export function Screener({
  select,
  correlate,
  overlay,
  saved,
  saveScreens,
}: {
  saved: Screen[];
  saveScreens: (next: Screen[]) => Promise<void>;
  select: (symbol: string) => void;
  correlate: (symbols: string[]) => void;
  overlay: (symbols: string[]) => void;
}) {
  const [screen, setScreen] = useState<Screen>(builtIns[0]);
  const [naming, setNaming] = useState(false);
  const universe = encodeURIComponent("S&P 500");
  const day = useSWR<{ quotes: Quote[] }>(`/api/market?universe=${universe}`, api, {
    revalidateOnFocus: false,
    errorRetryCount: 1,
  });
  const period = useSWR<{ quotes: Quote[] }>(
    `/api/market?universe=${universe}&since=${sinceDate(screen.lookback)}`,
    api,
    { revalidateOnFocus: false, errorRetryCount: 1, keepPreviousData: true },
  );
  const rows = useMemo<Row[]>(() => {
    const periods = new Map(period.data?.quotes.map((quote) => [quote.symbol, quote.periodPercent ?? null]));
    return (day.data?.quotes ?? []).map((quote) => {
      const info = sectorOf.get(quote.symbol);
      const span =
        quote.yearHigh != null && quote.yearLow != null && quote.yearHigh > quote.yearLow
          ? ((quote.price - quote.yearLow) / (quote.yearHigh - quote.yearLow)) * 100
          : null;
      return {
        symbol: quote.symbol,
        name: info?.name ?? quote.name,
        sector: info?.sector ?? "Other",
        price: quote.price,
        day: quote.percent,
        period: periods.get(quote.symbol) ?? null,
        position: span,
        turnover: quote.volume != null ? quote.volume * quote.price : null,
        cap: quote.cap,
      };
    });
  }, [day.data, period.data]);

  const query = screen.query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!screen.sectors.length || screen.sectors.includes(row.sector)) &&
          (!query || row.symbol.toLowerCase().includes(query) || row.name.toLowerCase().includes(query)) &&
          within(row.price, screen.price) &&
          within(row.day, screen.day) &&
          within(row.period, screen.period) &&
          within(row.position, screen.position) &&
          (screen.turnover === "" || (row.turnover ?? 0) >= Number(screen.turnover)),
      ),
    [rows, screen, query],
  );
  const accessors = useMemo(
    () => ({
      symbol: (row: Row) => row.symbol,
      name: (row: Row) => row.name,
      sector: (row: Row) => row.sector,
      price: (row: Row) => row.price,
      day: (row: Row) => row.day,
      period: (row: Row) => row.period,
      position: (row: Row) => row.position,
      turnover: (row: Row) => row.turnover,
    }),
    [],
  );
  const { sorted, sort, toggle } = useSort(matches, accessors, { key: "day", dir: "desc" });
  const sectorStats = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const row of matches)
      if (row.day != null) groups.set(row.sector, [...(groups.get(row.sector) ?? []), row.day]);
    return [...groups.entries()]
      .map(([sector, values]) => ({
        sector,
        count: values.length,
        average: values.reduce((sum, value) => sum + value, 0) / values.length,
      }))
      .sort((a, b) => b.average - a.average);
  }, [matches]);
  const update = (patch: Partial<Screen>) => setScreen({ ...screen, ...patch });
  const persist = (next: Screen[]) => void saveScreens(next).catch(() => undefined);
  const top = sorted.slice(0, 12).map((row) => row.symbol);

  return (
    <div className="eqs">
      <aside className="eqs-filters" aria-label="Screen criteria">
        <label className="graph-select eqs-block">
          Screen
          <select
            className="studio-select"
            value=""
            onChange={(event) => {
              const all = [...builtIns, ...saved];
              const chosen = all.find((item) => item.name === event.target.value);
              if (chosen) setScreen(chosen);
            }}
          >
            <option value="">{screen.name || "Custom"}</option>
            <optgroup label="Built in">
              {builtIns.map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </optgroup>
            {saved.length ? (
              <optgroup label="Saved">
                {saved.map((item) => (
                  <option key={item.name}>{item.name}</option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <input
          className="studio-select eqs-block"
          placeholder="Name or ticker contains"
          value={screen.query}
          onChange={(event) => update({ query: event.target.value, name: "" })}
          aria-label="Name or ticker"
        />
        <fieldset className="eqs-sectors">
          <legend>Sector</legend>
          {sectors.map((sector) => (
            <label key={sector}>
              <input
                type="checkbox"
                checked={screen.sectors.includes(sector)}
                onChange={() =>
                  update({
                    name: "",
                    sectors: screen.sectors.includes(sector)
                      ? screen.sectors.filter((item) => item !== sector)
                      : [...screen.sectors, sector],
                  })
                }
              />
              {sector}
            </label>
          ))}
        </fieldset>
        <RangeField label="Price" value={screen.price} onChange={(price) => update({ price, name: "" })} />
        <RangeField label="Day change" unit="%" value={screen.day} onChange={(value) => update({ day: value, name: "" })} />
        <div className="eqs-period">
          <RangeField
            label="Period change"
            unit="%"
            value={screen.period}
            onChange={(value) => update({ period: value, name: "" })}
          />
          <div className="seg seg-tight" role="group" aria-label="Period">
            {lookbackKeys.map((key) => (
              <button key={key} type="button" aria-pressed={screen.lookback === key} onClick={() => update({ lookback: key })}>
                {key}
              </button>
            ))}
          </div>
        </div>
        <RangeField
          label="52-week position"
          unit="% of range"
          value={screen.position}
          onChange={(position) => update({ position, name: "" })}
        />
        <label className="graph-select eqs-block">
          Min turnover
          <select className="studio-select" value={screen.turnover} onChange={(event) => update({ turnover: event.target.value, name: "" })}>
            <option value="">Any</option>
            <option value="100000000">100M</option>
            <option value="500000000">500M</option>
            <option value="1000000000">1B</option>
            <option value="5000000000">5B</option>
          </select>
        </label>
        <div className="row-actions">
          <button
            type="button"
            className="chip"
            onClick={() => setNaming(true)}
          >
            Save
          </button>
          {naming ? (
            <PromptDialog
              title="Save screen"
              description="Saved screens sync with your workspace. Using an existing name replaces it."
              label="Name"
              initial={screen.name || "My screen"}
              maxLength={80}
              onSubmit={(name) => {
                persist([...saved.filter((item) => item.name !== name), { ...screen, name }].slice(-20));
                update({ name });
              }}
              onClose={() => setNaming(false)}
            />
          ) : null}
          {saved.some((item) => item.name === screen.name) ? (
            <button type="button" className="chip" onClick={() => persist(saved.filter((item) => item.name !== screen.name))}>
              Delete
            </button>
          ) : null}
          <button type="button" className="chip" onClick={() => setScreen({ ...blank, name: "" })}>
            Reset
          </button>
        </div>
      </aside>
      <div className="term-stack eqs-results">
        <div className="term-toolbar">
          <strong className="eqs-count">
            {matches.length} <span>of {rows.length} S&amp;P 500 members</span>
          </strong>
          <div className="row-actions">
            <button type="button" className="chip" disabled={top.length < 2} onClick={() => correlate(top)} title="Correlation matrix of the top 12 rows">
              CORR top {Math.min(12, top.length)}
            </button>
            <button type="button" className="chip" disabled={!top.length} onClick={() => overlay(top.slice(0, 6))} title="Overlay the top 6 rows, rebased">
              G top {Math.min(6, top.length)}
            </button>
            <button
              type="button"
              className="chip"
              disabled={!sorted.length}
              onClick={() => downloadCsv(sorted.map((row) => ({ ...row })), "equity-screen")}
            >
              Export CSV
            </button>
          </div>
        </div>
        {sectorStats.length > 1 ? (
          <ul className="eqs-sector-bar" aria-label="Average day change by sector">
            {sectorStats.map((item) => (
              <li key={item.sector}>
                <button
                  type="button"
                  aria-pressed={screen.sectors.length === 1 && screen.sectors[0] === item.sector}
                  onClick={() => update({ sectors: [item.sector], name: "" })}
                >
                  <span>{item.sector}</span>
                  <Change value={item.average} />
                  <small>{item.count}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Failure error={day.error ?? period.error} retry={() => void day.mutate()} />
        {day.isLoading ? (
          <Loading message="Loading 500 quotes" />
        ) : !sorted.length ? (
          <Empty title="No matches">Loosen a criterion.</Empty>
        ) : (
          <div className="desk-table-wrap term-table-wrap">
            <table className="data-table term-table">
              <thead>
                <tr>
                  <SortHead label="Ticker" column="symbol" sort={sort} toggle={toggle} />
                  <SortHead label="Name" column="name" sort={sort} toggle={toggle} />
                  <SortHead label="Sector" column="sector" sort={sort} toggle={toggle} />
                  <SortHead label="Last" column="price" sort={sort} toggle={toggle} numeric />
                  <SortHead label="Day" column="day" sort={sort} toggle={toggle} numeric />
                  <SortHead label={screen.lookback} column="period" sort={sort} toggle={toggle} numeric />
                  <SortHead label="52W pos." column="position" sort={sort} toggle={toggle} numeric />
                  <SortHead label="Turnover" column="turnover" sort={sort} toggle={toggle} numeric />
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 300).map((row) => (
                  <tr key={row.symbol}>
                    <td>
                      <button type="button" className="security-link" onClick={() => select(row.symbol)}>
                        {row.symbol}
                      </button>
                    </td>
                    <td className="eqs-name">{row.name}</td>
                    <td className="muted">{row.sector}</td>
                    <td className="num">{amount(row.price)}</td>
                    <td className="num">
                      <Change value={row.day} />
                    </td>
                    <td className="num">
                      <Change value={row.period} />
                    </td>
                    <td className="num">
                      {row.position == null ? (
                        "—"
                      ) : (
                        <span className="range-bar" title={`${row.position.toFixed(0)}% of the 52-week range`}>
                          <i style={{ left: `${Math.min(100, Math.max(0, row.position))}%` }} />
                        </span>
                      )}
                    </td>
                    <td className="num">{compact(row.turnover)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="term-source">
          S&amp;P 500 constituents · exchange-delayed Yahoo Finance quotes · turnover is volume × last price. Saved screens sync with your workspace.
        </p>
      </div>
    </div>
  );
}
