"use client";

import { BellPlus } from "lucide-react";
import dynamic from "next/dynamic";
import { type FormEvent, useId, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Stamp } from "@/components/desk/frame";
import {
  BandMark,
  FearGreedFoot,
  FearGreedGauge,
  useFearGreed,
} from "@/components/fear-greed";
import { api, Empty, Failure, Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkspaceRecord } from "@/lib/db";
import {
  type BandKey,
  bandFor,
  bandLabel,
  bands,
  type DayScore,
  downsample,
  type FearGreedDay,
  type FearGreedHistoryResponse,
  type FearGreedResult,
  type FearGreedRule,
  forwardReturns,
  type HistoryRange,
  historyRanges,
  type IndicatorKey,
  indicatorInputs,
  rangeStart,
  regime,
  score1,
  signed1,
} from "@/lib/fear-greed-model";
import type { SignalCadence } from "@/lib/models";
import { cadenceLabels, signalStatus } from "@/lib/signals";
import type { HistoryRow } from "./fear-greed-history-chart";

const HistoryChart = dynamic(() => import("./fear-greed-history-chart"), {
  ssr: false,
  loading: () => <div className="fgm-chart skeleton" />,
});

const rangeLabels: Record<HistoryRange, string> = {
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  "1Y": "1Y",
  ALL: "All",
};

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const formatDay = (day: string) =>
  dayLabel.format(new Date(`${day}T00:00:00Z`));
const percent = (value: number | null, digits = 1) =>
  value == null
    ? "—"
    : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}%`;
const share = (value: number | null) =>
  value == null ? "—" : `${Math.round(value)}%`;

function useHistory(refresh: boolean) {
  return useSWR<FearGreedHistoryResponse>(
    "/api/market/fear-greed/history",
    api,
    { refreshInterval: refresh ? 15 * 60_000 : 0, errorRetryCount: 1 },
  );
}

function Changes({ data }: { data: FearGreedResult }) {
  const rows = [
    ["Prev close", data.previous.close],
    ["1 week", data.previous.week],
    ["1 month", data.previous.month],
    ["1 year", data.previous.year],
  ] as const;
  return (
    <div className="stat-row fgm-changes">
      {rows.map(([label, value]) => (
        <div className="figure" key={label}>
          <span className="figure-label">{label}</span>
          <strong
            className={`figure-value ${
              value == null
                ? ""
                : data.score - value > 0
                  ? "positive"
                  : data.score - value < 0
                    ? "negative"
                    : "neutral"
            }`}
          >
            {value == null ? "—" : signed1(data.score - value)}
          </strong>
          <span className="figure-sub">
            {value == null ? "—" : `from ${score1(value)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function RegimeBlock({
  points,
  range,
}: {
  points: DayScore[];
  range: HistoryRange;
}) {
  const stats = regime(points);
  if (!stats.total) return null;
  return (
    <div className="fgm-regime">
      <div className="stat-row">
        <div className="figure">
          <span className="figure-label">Percentile</span>
          <strong className="figure-value">{share(stats.percentile)}</strong>
          <span className="figure-sub">
            of {stats.total} readings, {rangeLabels[range]}
          </span>
        </div>
        {stats.streak ? (
          <div className="figure">
            <span className="figure-label">Streak</span>
            <strong className="figure-value">
              {stats.streak.days} day{stats.streak.days === 1 ? "" : "s"}
            </strong>
            <span className="figure-sub">
              in {bandLabel(stats.streak.band)} since{" "}
              {formatDay(stats.streak.since)}
            </span>
          </div>
        ) : null}
      </div>
      <div
        className="fgm-distribution"
        role="img"
        aria-label={`Days per band: ${stats.bands
          .map((band) => `${bandLabel(band.key)} ${band.days}`)
          .join(", ")}`}
      >
        {stats.bands.map((band) =>
          band.days ? (
            <i
              key={band.key}
              data-band={band.key}
              style={{ flexGrow: band.days }}
            />
          ) : null,
        )}
      </div>
      <table className="data-table fgm-bands">
        <thead>
          <tr>
            <th>Band</th>
            <th className="num">Days</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {stats.bands.map((band) => (
            <tr key={band.key}>
              <td>
                <BandMark band={band.key} />
              </td>
              <td className="num">{band.days}</td>
              <td className="num">{share(band.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span className="muted">—</span>;
  const sampled = downsample(values, 90);
  const low = Math.min(...sampled);
  const high = Math.max(...sampled);
  const spread = high - low || 1;
  const path = sampled
    .map(
      (value, index) =>
        `${index ? "L" : "M"}${((index / (sampled.length - 1)) * 100).toFixed(2)} ${(((high - value) / spread) * 100).toFixed(2)}`,
    )
    .join("");
  return (
    <svg
      className="fgm-spark"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path d={path} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Indicators({
  data,
  days,
}: {
  data: FearGreedResult;
  days: FearGreedDay[];
}) {
  const recent = days.slice(-252);
  const series = (key: IndicatorKey) =>
    recent.flatMap((row) => {
      const value = row.indicators[key]?.raw;
      return value == null ? [] : [value];
    });
  return (
    <div className="desk-table-wrap">
      <table className="data-table fgm-indicators">
        <thead>
          <tr>
            <th>Indicator</th>
            <th className="num">Score</th>
            <th>Rating</th>
            <th
              className="fgm-meter-head"
              aria-label="Position on the 0 to 100 scale"
            />
            <th className="fgm-spark-cell">Input, past year</th>
            <th className="num">Input</th>
          </tr>
        </thead>
        <tbody>
          {data.indicators.map((item) => {
            const input = indicatorInputs[item.key];
            return (
              <tr key={item.key}>
                <td>
                  <span className="fgm-indicator-name">{item.label}</span>
                  <span className="fgm-indicator-input">{input.label}</span>
                </td>
                <td className="num">{score1(item.score)}</td>
                <td>
                  <BandMark band={item.band} />
                </td>
                <td className="fg-meter-cell fgm-meter-head">
                  <span className="fg-meter" data-band={item.band}>
                    <i style={{ width: `${item.score}%` }} />
                  </span>
                </td>
                <td className="fgm-spark-cell">
                  <Spark
                    values={series(item.key)}
                    label={`${input.label} over the past year`}
                  />
                </td>
                <td className="num fgm-raw">
                  {item.raw == null ? "—" : input.format(item.raw)}
                  {item.reference != null && input.reference ? (
                    <small>
                      {input.reference} {input.format(item.reference)}
                    </small>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ForwardReturns({
  points,
  history,
  band,
}: {
  points: DayScore[];
  history: FearGreedHistoryResponse;
  band: BandKey;
}) {
  if (history.spxError)
    return (
      <Empty title="S&P 500 closes did not load">{history.spxError}</Empty>
    );
  const rows = forwardReturns(points, history.spx, band);
  const first = points[0]?.date;
  const last = points.at(-1)?.date;
  return (
    <>
      <div className="desk-table-wrap">
        <table className="data-table fgm-forward">
          <thead>
            <tr>
              <th rowSpan={2}>After</th>
              <th colSpan={3} className="fgm-group">
                In {bandLabel(band)}
              </th>
              <th colSpan={3} className="fgm-group">
                Every day
              </th>
            </tr>
            <tr>
              <th className="num">Median</th>
              <th className="num">Up</th>
              <th className="num">n</th>
              <th className="num">Median</th>
              <th className="num">Up</th>
              <th className="num">n</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.horizon}>
                <td>{row.horizon}</td>
                {[row.inBand, row.all].map((stat, index) => (
                  <StatCells
                    key={index}
                    median={stat.median}
                    hitRate={stat.hitRate}
                    n={stat.n}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fgm-note">
        S&amp;P 500 price return 21 and 63 trading days after each reading
        {first && last ? `, ${formatDay(first)} to ${formatDay(last)}` : ""}.
        Windows overlap, so n counts days rather than separate episodes. A short
        sample of history, not a forecast.
      </p>
    </>
  );
}

function StatCells({
  median,
  hitRate,
  n,
}: {
  median: number | null;
  hitRate: number | null;
  n: number;
}) {
  return (
    <>
      <td
        className={`num ${median == null ? "" : median >= 0 ? "positive" : "negative"}`}
      >
        {percent(median)}
      </td>
      <td className="num">{share(hitRate)}</td>
      <td className="num muted">{n}</td>
    </>
  );
}

type RuleKind = FearGreedRule["kind"];
const cadenceChoices: SignalCadence[] = ["tick", "hourly", "daily"];

function AlertForm({ score, close }: { score: number; close: () => void }) {
  const id = useId();
  const { mutate } = useSWRConfig();
  const [kind, setKind] = useState<RuleKind>(score >= 50 ? "below" : "above");
  const [threshold, setThreshold] = useState(score >= 50 ? "45" : "55");
  const [band, setBand] = useState<BandKey>("extremeFear");
  const [cadence, setCadence] = useState<SignalCadence>("hourly");
  const [repeat, setRepeat] = useState<"rearm" | "once">("rearm");
  const [error, setError] = useState<Error>();
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const level = Number(threshold);
    if (
      kind !== "band" &&
      !(Number.isInteger(level) && level >= 1 && level <= 99)
    ) {
      setError(new Error("Enter a whole number from 1 to 99."));
      return;
    }
    const rule: FearGreedRule =
      kind === "band" ? { kind, band } : { kind, threshold: level };
    setWorking(true);
    setError(undefined);
    try {
      const created = await api<{ name: string; trigger: boolean }>(
        "/api/market/fear-greed/alert",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rule, cadence, repeat }),
        },
      );
      setDone(
        `${created.name} is armed${created.trigger ? "; the condition is already true" : ""}.`,
      );
      await mutate("/api/workspace");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error("The alert was not created."),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <form
      className="fgm-alert"
      onSubmit={submit}
      aria-label="Fear & Greed alert"
    >
      <div className="fgm-alert-fields">
        <label className="field">
          <span>When the index</span>
          <Select
            value={kind}
            onValueChange={(value) => {
              if (value === "below" || value === "above" || value === "band")
                setKind(value);
            }}
          >
            <SelectTrigger size="sm" aria-label="Condition">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="below">falls below</SelectItem>
              <SelectItem value="above">rises above</SelectItem>
              <SelectItem value="band">enters band</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {kind === "band" ? (
          <label className="field">
            <span>Band</span>
            <Select
              value={band}
              onValueChange={(value) => {
                const next = bands.find((item) => item.key === value);
                if (next) setBand(next.key);
              }}
            >
              <SelectTrigger size="sm" aria-label="Band">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bands.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.label} ({item.min}–{item.max})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : (
          <label className="field" htmlFor={`${id}-level`}>
            <span>Level</span>
            <Input
              id={`${id}-level`}
              className="fgm-level"
              inputMode="numeric"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              aria-describedby={`${id}-now`}
            />
          </label>
        )}
        <label className="field">
          <span>Check</span>
          <Select
            value={cadence}
            onValueChange={(value) => {
              const next = cadenceChoices.find((item) => item === value);
              if (next) setCadence(next);
            }}
          >
            <SelectTrigger size="sm" aria-label="Check frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cadenceChoices.map((item) => (
                <SelectItem key={item} value={item}>
                  {cadenceLabels[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="field">
          <span>Repeat</span>
          <Select
            value={repeat}
            onValueChange={(value) => {
              if (value === "rearm" || value === "once") setRepeat(value);
            }}
          >
            <SelectTrigger size="sm" aria-label="Repeat">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rearm">Every crossing</SelectItem>
              <SelectItem value="once">Once, then pause</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <div className="fgm-alert-actions">
          <Button type="submit" size="sm" disabled={working}>
            {working ? "Creating…" : "Create alert"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={close}>
            Close
          </Button>
        </div>
      </div>
      <p id={`${id}-now`} className="fgm-note">
        Now {score1(score)}. Alerts go to your notification channels and show
        under Alerts → Signals.
      </p>
      {done ? (
        <p className="fgm-done" role="status">
          {done}
        </p>
      ) : null}
      <Failure error={error} />
    </form>
  );
}

function ExistingAlerts() {
  const { data } = useSWR<WorkspaceRecord>("/api/workspace", api, {
    revalidateOnMount: false,
  });
  const signals = (data?.data.signals ?? []).filter(
    (signal) => signal.data.fearGreed === true,
  );
  if (!signals.length) return null;
  return (
    <ul className="ruled-list fgm-signals">
      {signals.map((signal) => (
        <li key={signal.id}>
          <span>{signal.name}</span>
          <span className="meta">
            {signalStatus(signal)} · {cadenceLabels[signal.cadence]}
            {signal.lastValue == null
              ? ""
              : ` · last ${score1(signal.lastValue)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FearGreedMonitor({ refresh }: { refresh: boolean }) {
  const current = useFearGreed(refresh);
  const history = useHistory(refresh);
  const [range, setRange] = useState<HistoryRange>("1Y");
  const [showSpx, setShowSpx] = useState(true);
  const [alerting, setAlerting] = useState(false);
  const data = current.data;
  const days = history.data?.days;

  const all: DayScore[] = useMemo(
    () => (days ?? []).map((row) => ({ date: row.day, score: row.score })),
    [days],
  );
  const windowed = useMemo(() => {
    const last = all.at(-1)?.date;
    if (!last) return [];
    const start = rangeStart(range, last);
    return all.filter((point) => point.date >= start);
  }, [all, range]);
  const rows: HistoryRow[] = useMemo(() => {
    const closes = new Map(
      (history.data?.spx ?? []).map((row) => [row.date, row.close]),
    );
    return windowed.map((point) => ({
      time: Date.parse(`${point.date}T00:00:00Z`),
      score: point.score,
      spx: closes.get(point.date) ?? null,
    }));
  }, [windowed, history.data?.spx]);

  if (current.isLoading && !data)
    return <Loading message="Loading Fear & Greed" />;
  if (!data)
    return (
      <Failure error={current.error} retry={() => void current.mutate()} />
    );

  const band = bandFor(data.score).key;
  return (
    <div className="term-stack fgm">
      <div className="fgm-hero">
        <div className="fgm-gauge">
          <FearGreedGauge
            score={data.score}
            label={`Fear and Greed index ${score1(data.score)}, ${bandLabel(data.band)}`}
          />
          <strong className="fg-score fgm-score" data-band={data.band}>
            {score1(data.score)}
          </strong>
          <BandMark band={data.band} />
        </div>
        <div className="fgm-summary">
          <Changes data={data} />
          <div className="fgm-alert-bar">
            <Button
              variant={alerting ? "secondary" : "outline"}
              size="sm"
              aria-expanded={alerting}
              onClick={() => setAlerting(!alerting)}
            >
              <BellPlus aria-hidden />
              Alert me
            </Button>
            <span className="term-source">
              {data.source}
              {data.stale ? " · refresh failed, showing last reading" : ""} ·{" "}
              <Stamp ms={data.updatedAt} prefix="updated" />
            </span>
          </div>
          {alerting ? (
            <AlertForm score={data.score} close={() => setAlerting(false)} />
          ) : null}
          <ExistingAlerts />
        </div>
      </div>

      <div className="term-block">
        <div className="term-toolbar fgm-toolbar">
          <h3>History</h3>
          <div className="fgm-toolbar-controls">
            <button
              type="button"
              className="chip"
              aria-pressed={showSpx}
              onClick={() => setShowSpx(!showSpx)}
            >
              <i className="fgm-swatch" aria-hidden />
              S&amp;P 500
            </button>
            <div className="seg" role="group" aria-label="History range">
              {historyRanges.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={range === key}
                  onClick={() => setRange(key)}
                >
                  {rangeLabels[key]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Failure
          error={history.data ? undefined : history.error}
          retry={() => void history.mutate()}
        />
        {history.isLoading && !history.data ? (
          <div className="fgm-chart skeleton" />
        ) : rows.length > 1 ? (
          <HistoryChart rows={rows} showSpx={showSpx} />
        ) : history.data ? (
          <Empty title="No history in this range" />
        ) : null}
        {history.data ? (
          <p className="term-source">
            {history.data.source} daily closes
            {history.data.firstStored
              ? ` · stored since ${formatDay(history.data.firstStored)} (${history.data.storedDays} days)`
              : " · CNN's one-year window"}
            {showSpx ? " · S&P 500 from Yahoo Finance, USD" : ""}
          </p>
        ) : null}
      </div>

      <div className="quant-split fgm-split">
        <div className="term-block">
          <h3>Regime · {rangeLabels[range]}</h3>
          {history.data ? (
            <RegimeBlock points={windowed} range={range} />
          ) : (
            <Loading message="Loading history" />
          )}
        </div>
        <div className="term-block">
          <h3>S&amp;P 500 after readings like today</h3>
          {history.data ? (
            <ForwardReturns points={all} history={history.data} band={band} />
          ) : (
            <Loading message="Loading history" />
          )}
        </div>
      </div>

      <div className="term-block">
        <h3>Sub-indicators</h3>
        <Indicators data={data} days={days ?? []} />
        <p className="term-source fgm-foot">
          <FearGreedFoot data={data} />
        </p>
      </div>
    </div>
  );
}
