"use client";
import { useLocalZone } from "./time";
export type ChartPoint = {
  at: number;
  total: number;
  peak: number;
  dns: number | null;
  connection: number | null;
  tls: number | null;
  transfer: number | null;
};
const series = [
  { key: "dns", label: "Name lookup", color: "var(--chart-5)" },
  { key: "connection", label: "Connection", color: "var(--chart-6)" },
  { key: "tls", label: "TLS handshake", color: "var(--accent-strong)" },
  { key: "transfer", label: "Data transfer", color: "var(--accent)" },
] as const;
export function ResponseChart({
  points,
  from,
  to,
  step,
  outages,
}: {
  points: ChartPoint[];
  from: number;
  to: number;
  step: number;
  outages: { from: number; to: number }[];
}) {
  const timeZone = useLocalZone();
  if (!points.length)
    return (
      <div className="empty-state">
        <h3>No response timings in this range.</h3>
        <p>
          Regional timings appear after Better Stack collection. Dependency
          observations are available below.
        </p>
      </div>
    );
  const maximum = Math.max(100, ...points.map((p) => p.peak));
  const top = Math.ceil(maximum / 100) * 100;
  const x = (at: number) => 55 + ((at - from) / (to - from)) * 825;
  const y = (value: number) => 300 - (value / top) * 260;
  function paths(key: (typeof series)[number]["key"]) {
    let previous = 0;
    return points
      .map((point) => {
        const value = point[key];
        if (value === null) {
          previous = 0;
          return "";
        }
        const move = !previous || point.at - previous > step * 2;
        previous = point.at;
        return `${move ? "M" : "L"}${x(point.at).toFixed(1)},${y(value).toFixed(1)}`;
      })
      .join(" ");
  }
  return (
    <>
      <svg
        className="response-chart"
        viewBox="0 0 900 335"
        role="img"
        aria-labelledby="response-chart-title response-chart-description"
      >
        <title id="response-chart-title">
          Regional response time breakdown
        </title>
        <desc id="response-chart-description">
          Average DNS, connection, TLS, and data-transfer duration per time
          bucket in milliseconds. Shaded bands show incidents. Gaps mean no
          observations. The table below provides exact peak and percentile
          values.
        </desc>
        {Array.from({ length: 5 }, (_, index) => (
          <g key={index}>
            <line
              className="chart-grid"
              x1="55"
              x2="880"
              y1={y((top * index) / 4)}
              y2={y((top * index) / 4)}
            />
            <text
              className="chart-axis"
              x="43"
              y={y((top * index) / 4) + 4}
              textAnchor="end"
            >
              {(top * index) / 4 >= 1000
                ? `${((top * index) / 4000).toFixed(1)}s`
                : `${Math.round((top * index) / 4)}`}
            </text>
          </g>
        ))}
        {outages.map((outage, index) => (
          <rect
            key={index}
            x={x(Math.max(from, outage.from))}
            y="40"
            width={Math.max(
              2,
              x(Math.min(to, outage.to)) - x(Math.max(from, outage.from)),
            )}
            height="260"
            fill="var(--status-critical)"
            opacity=".1"
          />
        ))}
        {series.map(({ key, color }) => (
          <path
            key={key}
            d={paths(key)}
            fill="none"
            stroke={color}
            strokeWidth="1.6"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {Array.from({ length: 5 }, (_, index) => {
          const at = from + ((to - from) * index) / 4;
          return (
            <text
              key={index}
              x={x(at)}
              y="324"
              textAnchor={
                index === 0 ? "start" : index === 4 ? "end" : "middle"
              }
              className="chart-axis"
            >
              {new Intl.DateTimeFormat("en-GB", {
                timeZone,
                ...(to - from > 86400_000
                  ? { day: "numeric", month: "short" }
                  : { hour: "2-digit", minute: "2-digit" }),
              }).format(at)}
            </text>
          );
        })}
      </svg>
      <div className="chart-legend">
        {series.map(({ key, color, label }) => (
          <span key={key}>
            <i className="chart-swatch" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </>
  );
}
