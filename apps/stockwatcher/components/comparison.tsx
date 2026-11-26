"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { symbolPattern } from "@/lib/universes";
import { percent, tone } from "@/lib/utils";
import {
  api,
  Change,
  Empty,
  Failure,
  Loading,
  PanelHeading,
  SectionFoot,
} from "./shared";

const periods = ["1M", "3M", "6M", "YTD", "1Y"] as const;
type Period = (typeof periods)[number];
type Comparison = {
  points: Array<Record<string, string | number>>;
  symbols: string[];
  missing: string[];
  adjusted: boolean;
  source: string;
};

const colors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export default function ComparePanel({
  symbols,
  apply,
  since,
}: {
  symbols: string[];
  apply: (symbols: string[]) => void;
  since?: string;
}) {
  const [text, setText] = useState(symbols.join(", "));
  const [period, setPeriod] = useState<Period>("3M");
  const [invalid, setInvalid] = useState<Error>();
  const key =
    symbols.length > 1
      ? `/api/market?${new URLSearchParams({ compare: symbols.join(","), range: period, ...(since ? { since } : {}) })}`
      : null;
  const { data, error, mutate, isLoading } = useSWR<Comparison>(key, api, {
    errorRetryCount: 1,
  });
  return (
    <section className="panel comparison-panel">
      <PanelHeading
        title="Compare performance"
        subtitle={
          data?.adjusted
            ? "Adjusted price change over shared trading dates, in each instrument’s quote currency."
            : "Price change over shared trading dates, in each instrument’s quote currency."
        }
      />
      <div className="controls-inset">
        <form
          className="row-actions comparison-form"
          onSubmit={(event) => {
            event.preventDefault();
            const entries = [
              ...new Set(
                text
                  .toUpperCase()
                  .split(/[,\s]+/)
                  .filter(Boolean),
              ),
            ];
            if (
              entries.length < 2 ||
              entries.length > 6 ||
              entries.some((item) => !symbolPattern.test(item))
            ) {
              setInvalid(
                new Error(
                  "Enter two to six valid tickers, separated by commas.",
                ),
              );
              return;
            }
            setInvalid(undefined);
            apply(entries);
          }}
        >
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Symbols to compare"
            placeholder="AAPL, SAP.DE, ASML.AS"
            maxLength={140}
            required
          />
          <Button type="submit" variant="outline" size="sm">
            Compare
          </Button>
        </form>
        {since ? (
          <span className="muted">Since {since}</span>
        ) : (
          <div className="seg" role="group" aria-label="Comparison period">
            {periods.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={item === period}
                onClick={() => setPeriod(item)}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
      <Failure
        error={invalid || error}
        retry={error && !invalid ? mutate : undefined}
      />
      {isLoading ? (
        <Loading />
      ) : data?.points.length ? (
        <>
          <div className="comparison-values">
            {data.symbols
              .map((symbol, index) => ({
                symbol,
                color: colors[index],
                value: data.points.at(-1)?.[symbol],
              }))
              .map(({ symbol, color, value }) => (
                <div key={symbol}>
                  <i style={{ background: color }} />
                  <strong>{symbol}</strong>
                  <Change value={typeof value === "number" ? value : null} />
                </div>
              ))}
          </div>
          <div className="price-chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart
                data={data.points}
                margin={{ top: 8, right: 10, left: 5, bottom: 4 }}
              >
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <ReferenceLine y={0} stroke="var(--strong-border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => dayFormat.format(new Date(date))}
                  axisLine={{ stroke: "var(--strong-border)" }}
                  tickLine={false}
                  minTickGap={40}
                  tickMargin={7}
                  height={24}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <YAxis
                  width={65}
                  orientation="right"
                  tickFormatter={(number: number) =>
                    `${number > 0 ? "+" : ""}${Math.round(number)}%`
                  }
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                  isAnimationActive={false}
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="chart-tip">
                        <strong>
                          {dayFormat.format(new Date(String(label)))}
                        </strong>
                        {payload.map((entry) => (
                          <span key={String(entry.dataKey)} className="tip-row">
                            <i style={{ background: entry.color }} />
                            {String(entry.dataKey)}
                            <b className={tone(Number(entry.value))}>
                              {percent(Number(entry.value))}
                            </b>
                          </span>
                        ))}
                      </div>
                    ) : null
                  }
                />
                {data.symbols.map((symbol, index) => (
                  <Line
                    key={symbol}
                    dataKey={symbol}
                    stroke={colors[index]}
                    strokeWidth={1.6}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <SectionFoot>
            <span>
              {data.source} · percent change from the first shared close
            </span>
            {data.missing.length ? (
              <span className="negative">
                Missing series: {data.missing.join(", ")}
              </span>
            ) : null}
          </SectionFoot>
        </>
      ) : !error ? (
        <Empty
          title={
            data
              ? "No shared price history"
              : "Compare stocks, ETFs, and indices"
          }
        >
          {data
            ? "Try a longer date range or different tickers."
            : "Enter two to six symbols to see how their percentage moves compare."}
        </Empty>
      ) : null}
    </section>
  );
}
