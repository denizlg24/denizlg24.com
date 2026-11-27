"use client";

import dynamic from "next/dynamic";
import useSWR from "swr";
import { SkeletonRows, Stamp } from "@/components/desk/frame";
import { api, Failure } from "@/components/shared";
import {
  type BandKey,
  bandFor,
  bandLabel,
  bands,
  type FearGreedResult,
  score1,
  signed1,
} from "@/lib/fear-greed-model";

const FearGreedChart = dynamic(() => import("./fear-greed-chart"), {
  ssr: false,
  loading: () => <div className="fg-chart-placeholder skeleton" />,
});

export function useFearGreed(refresh = true) {
  return useSWR<FearGreedResult>("/api/market/fear-greed", api, {
    refreshInterval: refresh ? 60_000 : 0,
    errorRetryCount: 1,
  });
}

export function BandMark({ band }: { band: BandKey }) {
  return (
    <span className="fg-band" data-band={band}>
      <i aria-hidden />
      {bandLabel(band)}
    </span>
  );
}

const CX = 100;
const CY = 98;
const RADIUS = 84;
const point = (score: number, radius: number) => {
  const angle = Math.PI * (1 - score / 100);
  return [
    CX + radius * Math.cos(angle),
    CY - radius * Math.sin(angle),
  ] as const;
};
const arc = (from: number, to: number) => {
  const [x1, y1] = point(from, RADIUS);
  const [x2, y2] = point(to, RADIUS);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${RADIUS} ${RADIUS} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

export function FearGreedGauge({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  const [x, y] = point(score, RADIUS - 14);
  return (
    <svg
      className="fg-gauge"
      viewBox="0 0 200 108"
      role="img"
      aria-label={label}
    >
      {bands.map((band) => (
        <path
          key={band.key}
          d={arc(band.min + 0.6, band.max - 0.6)}
          data-band={band.key}
          className="fg-arc"
        />
      ))}
      <line x1={CX} y1={CY} x2={x} y2={y} className="fg-needle" />
      <circle cx={CX} cy={CY} r={4} className="fg-hub" />
    </svg>
  );
}

function Comparisons({ data }: { data: FearGreedResult }) {
  const rows = [
    ["Previous close", data.previous.close],
    ["1 week ago", data.previous.week],
    ["1 month ago", data.previous.month],
    ["1 year ago", data.previous.year],
  ] as const;
  return (
    <table className="data-table fg-table">
      <thead>
        <tr>
          <th>Compared with</th>
          <th className="num">Score</th>
          <th>Rating</th>
          <th className="num">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="num">{value == null ? "—" : score1(value)}</td>
            <td>
              {value == null ? "—" : <BandMark band={bandFor(value).key} />}
            </td>
            <td className="num">
              {value == null ? "—" : signed1(data.score - value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Indicators({ data }: { data: FearGreedResult }) {
  return (
    <table className="data-table fg-table">
      <thead>
        <tr>
          <th>Indicator</th>
          <th className="num">Score</th>
          <th>Rating</th>
          <th aria-label="Position on the 0 to 100 scale" />
        </tr>
      </thead>
      <tbody>
        {data.indicators.map((item) => (
          <tr key={item.key}>
            <td>{item.label}</td>
            <td className="num">{score1(item.score)}</td>
            <td>
              <BandMark band={item.band} />
            </td>
            <td className="fg-meter-cell">
              <span className="fg-meter" data-band={item.band}>
                <i style={{ width: `${item.score}%` }} />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FearGreedFoot({ data }: { data: FearGreedResult }) {
  return (
    <>
      <span>
        {data.source}
        {data.stale ? " · refresh failed, showing last reading" : ""}
      </span>
      <span>
        <Stamp ms={data.updatedAt} prefix="Updated" />
        {data.stale ? (
          <>
            {" · "}
            <Stamp ms={data.fetchedAt} prefix="fetched" />
          </>
        ) : null}
      </span>
    </>
  );
}

export function FearGreedPanel({ refresh }: { refresh: boolean }) {
  const { data, error, mutate, isLoading } = useFearGreed(refresh);
  return (
    <section className="section fg-panel">
      <header className="section-head">
        <div>
          <h2>Fear &amp; Greed</h2>
          <p>CNN index of US market sentiment, 0 to 100</p>
        </div>
      </header>
      <div className="section-body">
        <Failure error={data ? undefined : error} retry={mutate} />
        {isLoading ? (
          <SkeletonRows rows={5} label="Loading Fear & Greed" />
        ) : data ? (
          <div className="fg-layout">
            <div className="fg-hero">
              <FearGreedGauge
                score={data.score}
                label={`Fear and Greed index ${score1(data.score)}, ${bandLabel(data.band)}`}
              />
              <strong className="fg-score" data-band={data.band}>
                {score1(data.score)}
              </strong>
              <BandMark band={data.band} />
              <ul className="fg-scale" aria-hidden>
                {bands.map((band) => (
                  <li key={band.key} data-band={band.key}>
                    <i />
                    {band.label}
                  </li>
                ))}
              </ul>
            </div>
            <Comparisons data={data} />
            <div className="fg-history">
              <span className="kicker">Past year</span>
              <FearGreedChart history={data.history} />
            </div>
            <Indicators data={data} />
          </div>
        ) : null}
      </div>
      {data ? (
        <footer className="section-foot">
          <FearGreedFoot data={data} />
        </footer>
      ) : null}
    </section>
  );
}
