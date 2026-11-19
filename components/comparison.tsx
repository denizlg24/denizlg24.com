"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, Change, Empty, Failure, Loading, PanelHeading } from "./shared";
import { amount, cn } from "@/lib/utils";
import { symbolPattern } from "@/lib/universes";

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
  "var(--gain)",
  "var(--chart-2)",
  "#6876ce",
  "var(--loss)",
  "#7d61ac",
  "#087991",
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
        <div className="segmented" role="group" aria-label="Comparison period">
          {since ? (
            <span>Since {since}</span>
          ) : (
            periods.map((item) => (
              <Button
                key={item}
                size="sm"
                variant={item === period ? "secondary" : "ghost"}
                aria-pressed={item === period}
                onClick={() => setPeriod(item)}
              >
                {item}
              </Button>
            ))
          )}
        </div>
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
            {data.symbols.map((symbol, index) => (
              <div key={symbol}>
                <i style={{ background: colors[index] }} />
                <strong>{symbol}</strong>
                <Change
                  value={data.points.at(-1)?.[symbol] as number | undefined}
                />
              </div>
            ))}
          </div>
          <div className="price-chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart
                data={data.points}
                margin={{ top: 8, right: 10, left: 5, bottom: 4 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 4"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => dayFormat.format(new Date(date))}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={28}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <YAxis
                  width={65}
                  orientation="right"
                  tickFormatter={(number) => `${amount(number)}%`}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    color: "var(--foreground)",
                    borderColor: "var(--border)",
                    borderRadius: "8px",
                  }}
                  formatter={(value) => `${amount(Number(value))}%`}
                />
                <Legend />
                {data.symbols.map((symbol, index) => (
                  <Line
                    key={symbol}
                    dataKey={symbol}
                    stroke={colors[index]}
                    strokeWidth={2.1}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className={cn("panel-foot", data.missing.length && "negative")}>
            {data.source}
            {data.missing.length
              ? ` · missing series: ${data.missing.join(", ")}`
              : ""}
          </div>
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
