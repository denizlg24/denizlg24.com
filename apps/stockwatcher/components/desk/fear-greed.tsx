"use client";

import { Settings2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import {
  BandMark,
  FearGreedFoot,
  FearGreedGauge,
  useFearGreed,
} from "@/components/fear-greed";
import { Failure } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { type FearGreedVariant, fearGreedVariants } from "@/lib/desk";
import {
  bandLabel,
  type FearGreedPoint,
  type FearGreedResult,
  score1,
  signed1,
} from "@/lib/fear-greed-model";
import { SkeletonRows, WidgetFrame, type WidgetProps } from "./frame";

const FearGreedChart = dynamic(() => import("../fear-greed-chart"), {
  ssr: false,
  loading: () => <div className="fg-chart skeleton" />,
});

const variantLabels: Record<FearGreedVariant, string> = {
  gauge: "Gauge",
  history: "History",
  indicators: "Indicators",
};

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

function Gauge({ data }: { data: FearGreedResult }) {
  const change =
    data.previous.close == null ? null : data.score - data.previous.close;
  return (
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
  );
}

function Bars({ data }: { data: FearGreedResult }) {
  return (
    <ul className="fg-bars">
      {data.indicators.map((item) => (
        <li key={item.key}>
          <span title={item.label}>{item.label}</span>
          <span
            className="fg-meter"
            data-band={item.band}
            role="img"
            aria-label={`${score1(item.score)}, ${bandLabel(item.band)}`}
          >
            <i style={{ width: `${item.score}%` }} />
          </span>
          <span className="num">{score1(item.score)}</span>
        </li>
      ))}
    </ul>
  );
}

export function FearGreedWidget({ widget, ctx }: WidgetProps<"fearGreed">) {
  const { data, error, mutate, isLoading } = useFearGreed(ctx.refresh);
  const [configuring, setConfiguring] = useState(false);
  const variant = widget.variant;
  return (
    <WidgetFrame
      label="Fear & Greed"
      className="desk-fear-greed"
      subtitle={
        data ? `${score1(data.score)} · ${bandLabel(data.band)}` : undefined
      }
      ask={
        data
          ? `CNN Fear & Greed is ${score1(data.score)} (${bandLabel(data.band)}). Which sub-indicators are driving it, and how does it compare with last week and last month?`
          : undefined
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => ctx.onOpenView({ view: "monitor", fn: "FEAR" })}
          >
            Open
          </Button>
          <Button
            variant={configuring ? "secondary" : "ghost"}
            size="icon-xs"
            aria-label="Widget settings"
            aria-expanded={configuring}
            title="Widget settings"
            onClick={() => setConfiguring(!configuring)}
          >
            <Settings2 />
          </Button>
        </>
      }
      foot={data ? <FearGreedFoot data={data} /> : undefined}
    >
      {configuring ? (
        <div className="fg-variant-picker">
          <span className="kicker">Show</span>
          <div className="seg" role="group" aria-label="Widget view">
            {fearGreedVariants.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={variant === key}
                onClick={() => void ctx.update({ ...widget, variant: key })}
              >
                {variantLabels[key]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <Failure error={data ? undefined : error} retry={mutate} />
      {isLoading ? (
        <SkeletonRows rows={3} label="Loading Fear & Greed" />
      ) : data ? (
        variant === "history" ? (
          <div className="fg-widget-chart">
            <FearGreedChart history={data.history} />
          </div>
        ) : variant === "indicators" ? (
          <Bars data={data} />
        ) : (
          <Gauge data={data} />
        )
      ) : null}
    </WidgetFrame>
  );
}
