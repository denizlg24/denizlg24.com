"use client";

import type { MacroCatalog, MacroHistory } from "@repo/markets/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { NativeSelect, NativeSelectOption } from "@repo/ui/native-select";
import { Skeleton } from "@repo/ui/skeleton";
import { memo, useEffect, useMemo, useState } from "react";
import { useAdmin } from "../provider";
import { CandleChart } from "./candle-chart";

const valueFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3,
});
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeZone: "UTC",
});

export const MacroPanel = memo(function MacroPanel() {
  const { client } = useAdmin();
  const [catalog, setCatalog] = useState<MacroCatalog | null>(null);
  const [history, setHistory] = useState<MacroHistory | null>(null);
  const [series, setSeries] = useState("CPIAUCSL");
  const [range, setRange] = useState("5");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    client
      .get<MacroCatalog>("/markets/macro")
      .then((data) => {
        if (active) setCatalog(data);
      })
      .catch(() => {
        if (active) setError("Economic indicators are unavailable.");
      });
    return () => {
      active = false;
    };
  }, [client, attempt]);

  useEffect(() => {
    let active = true;
    const from = new Date();
    from.setUTCFullYear(from.getUTCFullYear() - Number(range));
    const query =
      range === "max" ? "" : `?from=${from.toISOString().slice(0, 10)}`;
    client
      .get<MacroHistory>(`/markets/macro/${series}${query}`)
      .then((data) => {
        if (active) setHistory(data);
      })
      .catch(() => {
        if (active) setError("Economic data could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [client, series, range, attempt]);

  const latest = history?.observations.at(-1);
  const bars = useMemo(
    () =>
      history?.observations.map(({ date, value }) => ({
        ts: `${date}T00:00:00Z`,
        open: value,
        high: value,
        low: value,
        close: value,
        volume: 0,
      })) ?? [],
    [history],
  );

  return (
    <section
      id="markets-macro"
      className="shrink-0 space-y-3 border-b px-4 py-3 sm:px-5"
      aria-labelledby="markets-macro-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="markets-macro-title" className="font-semibold text-sm">
          Economic indicators
        </h2>
        {catalog?.series.length ? (
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              aria-label="Economic indicator"
              value={series}
              className="max-w-full"
              onChange={(event) => {
                setHistory(null);
                setError("");
                setSeries(event.target.value);
              }}
            >
              {catalog.series.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Observation history range"
              value={range}
              onChange={(event) => {
                setHistory(null);
                setError("");
                setRange(event.target.value);
              }}
            >
              <NativeSelectOption value="1">1 year</NativeSelectOption>
              <NativeSelectOption value="5">5 years</NativeSelectOption>
              <NativeSelectOption value="10">10 years</NativeSelectOption>
              <NativeSelectOption value="max">All history</NativeSelectOption>
            </NativeSelect>
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="flex items-center gap-2 text-sm" role="status">
          <span>{error}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError("");
              setAttempt((current) => current + 1);
            }}
          >
            Retry
          </Button>
        </div>
      ) : !history ? (
        <Skeleton className="h-60 w-full" aria-label="Loading economic data" />
      ) : latest ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-semibold text-lg tabular-nums">
              {valueFormat.format(latest.value)}
            </span>
            <span className="text-muted-foreground text-xs">
              {history.series.units}
            </span>
            <span className="text-muted-foreground text-xs">
              {dateFormat.format(new Date(latest.date))}
            </span>
            {history.freshness.stale ? (
              <Badge variant="warning">Stale</Badge>
            ) : null}
            <a
              href={history.series.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-sm underline underline-offset-2"
            >
              FRED
            </a>
          </div>
          <CandleChart
            bars={bars}
            kind="area"
            showVolume={false}
            height={216}
            fitKey={`${series}:${range}`}
          />
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          No observations in this date range.
        </p>
      )}
    </section>
  );
});
