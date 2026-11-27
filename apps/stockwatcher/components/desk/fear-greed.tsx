"use client";

import {
  BandMark,
  FearGreedFoot,
  FearGreedGauge,
  useFearGreed,
} from "@/components/fear-greed";
import { Failure } from "@/components/shared";
import {
  bandLabel,
  type FearGreedPoint,
  score1,
  signed1,
} from "@/lib/fear-greed-model";
import { SkeletonRows, WidgetFrame, type WidgetProps } from "./frame";

function Sparkline({ history }: { history: FearGreedPoint[] }) {
  if (history.length < 2) return null;
  const recent = history.slice(-60);
  const first = recent[0].time;
  const span = recent[recent.length - 1].time - first || 1;
  const path = recent
    .map(
      (item, index) =>
        `${index ? "L" : "M"}${(((item.time - first) / span) * 100).toFixed(2)} ${(100 - item.score).toFixed(1)}`,
    )
    .join("");
  return (
    <svg
      className="fg-spark"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label="Index over the last 60 sessions"
    >
      {[25, 45, 55, 75].map((level) => (
        <line key={level} x1={0} x2={100} y1={100 - level} y2={100 - level} />
      ))}
      <path d={path} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function FearGreedWidget({ ctx }: WidgetProps<"fearGreed">) {
  const { data, error, mutate, isLoading } = useFearGreed(ctx.refresh);
  const change =
    data?.previous.close == null ? null : data.score - data.previous.close;
  return (
    <WidgetFrame
      label="Fear & Greed"
      className="desk-fear-greed"
      subtitle={data ? bandLabel(data.band) : undefined}
      ask={
        data
          ? `CNN Fear & Greed is ${score1(data.score)} (${bandLabel(data.band)}). Which sub-indicators are driving it, and how does it compare with last week and last month?`
          : undefined
      }
      foot={data ? <FearGreedFoot data={data} /> : undefined}
    >
      <Failure error={data ? undefined : error} retry={mutate} />
      {isLoading ? (
        <SkeletonRows rows={3} label="Loading Fear & Greed" />
      ) : data ? (
        <div className="fg-compact">
          <div className="fg-compact-gauge">
            <FearGreedGauge
              score={data.score}
              label={`Fear and Greed index ${score1(data.score)}, ${bandLabel(data.band)}`}
            />
            <strong className="fg-score" data-band={data.band}>
              {score1(data.score)}
            </strong>
          </div>
          <div className="fg-compact-side">
            <BandMark band={data.band} />
            <span className="fg-delta">
              {change == null ? "—" : signed1(change)}
              <small> vs previous close</small>
            </span>
            <Sparkline history={data.history} />
          </div>
        </div>
      ) : null}
    </WidgetFrame>
  );
}
