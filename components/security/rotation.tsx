"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Empty, Failure, Loading } from "@/components/shared";
import { quadrant, rotation, type RotationPoint } from "@/lib/analytics";
import { symbolPattern } from "@/lib/universes";
import { number } from "@/lib/utils";
import { useHistory } from "./quant";

const universes: Record<string, { benchmark: string; members: [string, string][] }> = {
  "US sectors": {
    benchmark: "SPY",
    members: [
      ["XLK", "Technology"],
      ["XLF", "Financials"],
      ["XLV", "Health care"],
      ["XLY", "Discretionary"],
      ["XLP", "Staples"],
      ["XLE", "Energy"],
      ["XLI", "Industrials"],
      ["XLB", "Materials"],
      ["XLU", "Utilities"],
      ["XLRE", "Real estate"],
      ["XLC", "Communication"],
    ],
  },
  "Global equity": {
    benchmark: "ACWI",
    members: [
      ["SPY", "US"],
      ["EZU", "Eurozone"],
      ["EWU", "UK"],
      ["EWJ", "Japan"],
      ["MCHI", "China"],
      ["INDA", "India"],
      ["EWZ", "Brazil"],
      ["EWY", "Korea"],
      ["EWT", "Taiwan"],
    ],
  },
  "Factors": {
    benchmark: "SPY",
    members: [
      ["MTUM", "Momentum"],
      ["QUAL", "Quality"],
      ["VLUE", "Value"],
      ["USMV", "Min vol"],
      ["SIZE", "Size"],
      ["IWM", "Small caps"],
      ["RSP", "Equal weight"],
    ],
  },
  "Cross-asset": {
    benchmark: "AOR",
    members: [
      ["SPY", "US equity"],
      ["EFA", "Intl equity"],
      ["TLT", "Long Treasuries"],
      ["HYG", "High yield"],
      ["GLD", "Gold"],
      ["DBC", "Commodities"],
      ["UUP", "Dollar"],
      ["IBIT", "Bitcoin"],
    ],
  },
};
const palette = [
  "#e0a030",
  "#3f8fd8",
  "#d0503c",
  "#3aa776",
  "#a565c9",
  "#23798a",
  "#c9a227",
  "#8a4a8f",
  "#6b6f2a",
  "#94600f",
  "#3f5fa8",
];
const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };

export function Rotation({ select }: { select: (symbol: string) => void }) {
  const [group, setGroup] = useState("US sectors");
  const [tail, setTail] = useState(8);
  const [window, setWindow] = useState(10);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [benchmark, setBenchmark] = useState(universes["US sectors"].benchmark);
  const members = universes[group].members;
  const { data, error, isLoading, mutate } = useHistory(
    [benchmark, ...members.map(([symbol]) => symbol)],
    2,
    "1wk",
  );
  const paths = useMemo(() => {
    const bench = data?.series.find((item) => item.symbol === benchmark)?.points ?? [];
    return members.flatMap(([symbol, label], index) => {
      const points = data?.series.find((item) => item.symbol === symbol)?.points;
      if (!points || !bench.length) return [];
      const path = rotation(points, bench, window);
      return path.length ? [{ symbol, label, color: palette[index % palette.length], path }] : [];
    });
  }, [data, benchmark, members, window]);
  const shown = paths.filter((item) => !hidden.has(item.symbol));
  const extent = Math.max(
    2,
    ...shown.flatMap((item) =>
      item.path.slice(-tail).flatMap((point) => [Math.abs(point.ratio - 100), Math.abs(point.momentum - 100)]),
    ),
  );
  const domain: [number, number] = [100 - extent * 1.1, 100 + extent * 1.1];

  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="row-actions">
          <div className="seg" role="group" aria-label="Universe">
            {Object.keys(universes).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={group === name}
                onClick={() => {
                  setGroup(name);
                  setBenchmark(universes[name].benchmark);
                  setHidden(new Set());
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <label className="graph-select">
            vs
            <input
              className="studio-select quant-number"
              value={benchmark}
              aria-label="Benchmark"
              onChange={(event) => {
                const value = event.target.value.toUpperCase();
                if (symbolPattern.test(value)) setBenchmark(value);
              }}
            />
          </label>
          <label className="graph-select">
            Tail
            <input type="range" min={1} max={26} value={tail} onChange={(event) => setTail(Number(event.target.value))} />
            <b>{tail}W</b>
          </label>
          <label className="graph-select">
            Smoothing
            <select className="studio-select" value={window} onChange={(event) => setWindow(Number(event.target.value))}>
              {[5, 10, 14, 20].map((value) => (
                <option key={value} value={value}>
                  {value}W
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {error ? <Failure error={error} retry={() => void mutate()} /> : null}
      {isLoading && !data ? (
        <Loading message="Loading weekly history" />
      ) : !paths.length ? (
        <Empty title="No overlapping history" />
      ) : (
        <div className="rrg">
          <div className="rrg-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 18 }}>
                <ReferenceArea x1={100} x2={domain[1]} y1={100} y2={domain[1]} fill="var(--gain)" fillOpacity={0.07} />
                <ReferenceArea x1={100} x2={domain[1]} y1={domain[0]} y2={100} fill="var(--term-key)" fillOpacity={0.07} />
                <ReferenceArea x1={domain[0]} x2={100} y1={domain[0]} y2={100} fill="var(--loss)" fillOpacity={0.07} />
                <ReferenceArea x1={domain[0]} x2={100} y1={100} y2={domain[1]} fill="var(--live)" fillOpacity={0.07} />
                <CartesianGrid stroke="var(--rule)" />
                <XAxis type="number" dataKey="ratio" domain={domain} tick={axisTick} tickFormatter={(v: number) => v.toFixed(1)} label={{ value: "RS-Ratio", position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 10 }} allowDataOverflow />
                <YAxis type="number" dataKey="momentum" domain={domain} tick={axisTick} tickFormatter={(v: number) => v.toFixed(1)} width={44} allowDataOverflow />
                <ReferenceLine x={100} stroke="var(--strong-border)" />
                <ReferenceLine y={100} stroke="var(--strong-border)" />
                <Tooltip
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    const point = payload?.[0]?.payload as (RotationPoint & { symbol?: string }) | undefined;
                    if (!active || !point?.symbol) return null;
                    return (
                      <div className="quant-tip">
                        <b>
                          {point.symbol} · {new Date(point.time * 1000).toISOString().slice(0, 10)}
                        </b>
                        <span>RS-Ratio {number(point.ratio)}</span>
                        <span>RS-Momentum {number(point.momentum)}</span>
                        <span>{quadrant(point)}</span>
                      </div>
                    );
                  }}
                />
                {shown.map((item) => {
                  const recent = item.path.slice(-tail).map((point) => ({ ...point, symbol: item.symbol }));
                  return (
                    <Scatter
                      key={item.symbol}
                      data={recent}
                      fill={item.color}
                      line={{ stroke: item.color, strokeWidth: 1.4 }}
                      isAnimationActive={false}
                      shape={(props: { cx?: number; cy?: number; index?: number }) => {
                        const last = props.index === recent.length - 1;
                        if (props.cx == null || props.cy == null) return <g />;
                        return (
                          <g>
                            <circle cx={props.cx} cy={props.cy} r={last ? 5 : 2} fill={item.color} fillOpacity={last ? 1 : 0.6} />
                            {last ? (
                              <text x={props.cx + 7} y={props.cy + 4} className="rrg-label" fill={item.color}>
                                {item.symbol}
                              </text>
                            ) : null}
                          </g>
                        );
                      }}
                    />
                  );
                })}
              </ScatterChart>
            </ResponsiveContainer>
            <span className="rrg-corner" data-at="tr">Leading</span>
            <span className="rrg-corner" data-at="br">Weakening</span>
            <span className="rrg-corner" data-at="bl">Lagging</span>
            <span className="rrg-corner" data-at="tl">Improving</span>
          </div>
          <table className="data-table term-table rrg-table">
            <thead>
              <tr>
                <th />
                <th>Ticker</th>
                <th className="num">Ratio</th>
                <th className="num">Mom.</th>
                <th>Quadrant</th>
              </tr>
            </thead>
            <tbody>
              {paths.map((item) => {
                const last = item.path.at(-1)!;
                return (
                  <tr key={item.symbol} data-hidden={hidden.has(item.symbol) || undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!hidden.has(item.symbol)}
                        aria-label={`Show ${item.symbol}`}
                        onChange={() => {
                          const next = new Set(hidden);
                          if (next.has(item.symbol)) next.delete(item.symbol);
                          else next.add(item.symbol);
                          setHidden(next);
                        }}
                        style={{ accentColor: item.color }}
                      />
                    </td>
                    <td>
                      <button type="button" className="security-link" style={{ color: item.color }} onClick={() => select(item.symbol)} title={item.label}>
                        {item.symbol}
                      </button>{" "}
                      <small className="muted">{item.label}</small>
                    </td>
                    <td className="num">{number(last.ratio)}</td>
                    <td className="num">{number(last.momentum)}</td>
                    <td data-quadrant={quadrant(last)}>{quadrant(last)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="term-source">
        Weekly closes over two years. RS-Ratio is relative strength versus {benchmark} against its {window}-week mean; RS-Momentum is that
        ratio&apos;s change over {Math.round(window / 2)} weeks. Rotation typically runs clockwise: improving, leading, weakening, lagging.
      </p>
    </div>
  );
}
