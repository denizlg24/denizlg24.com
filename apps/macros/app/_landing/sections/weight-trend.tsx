import { cn } from "@repo/ui/utils";
import {
  weightGoalKg,
  weightMonths,
  weightSeries,
  weightStats,
} from "@/app/_landing/demo-data";
import { InView } from "@/app/_landing/in-view";
import { delay } from "@/app/_landing/phone/ios";
import {
  type SectionLink,
  sectionLead,
  sectionTitle,
} from "@/app/_landing/sections/feature-row";
import { container, MoreLink, SectionLabel } from "@/app/_landing/site";

const DOMAIN: readonly [number, number] = [74.2, 84.8];
const TICKS = [76, 78, 80, 82, 84];
const LAST_DAY = weightSeries.length - 1;

const xPct = (day: number) => (day / LAST_DAY) * 100;
const yPct = (kg: number) => ((DOMAIN[1] - kg) / (DOMAIN[1] - DOMAIN[0])) * 100;

function path(points: ReadonlyArray<readonly [number, number]>) {
  return points
    .map(
      ([x, y], index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`,
    )
    .join(" ");
}

const trendPath = path(
  weightSeries.map((point) => [xPct(point.day), yPct(point.trend)] as const),
);

const bandPath = `${path(
  weightSeries.map(
    (point) => [xPct(point.day), yPct(point.trend + point.band)] as const,
  ),
)} ${path(
  weightSeries
    .map((point) => [xPct(point.day), yPct(point.trend - point.band)] as const)
    .reverse(),
).replace(/^M/, "L")} Z`;

const WIPE_SECONDS = 2.2;

function TrendChart() {
  const last = weightSeries[LAST_DAY];
  return (
    <div className="relative h-[280px] sm:h-[360px] lg:h-[400px]">
      <div className="absolute inset-x-0 top-0 bottom-8">
        {TICKS.map((tick) => (
          <div
            key={tick}
            className="absolute inset-x-0 flex items-center gap-3"
            style={{ top: `${yPct(tick)}%` }}
          >
            <span className="h-px flex-1 bg-border" />
            <span className="w-8 -translate-y-px text-right font-figure text-xs text-muted-foreground">
              {tick}
            </span>
          </div>
        ))}

        <div className="absolute inset-y-0 left-0 right-11">
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="a-fade absolute inset-0 size-full overflow-visible"
            style={delay(1.1)}
          >
            <path d={bandPath} fill="currentColor" fillOpacity={0.07} />
          </svg>

          <div
            className="a-fade absolute inset-x-0 border-t border-dashed border-muted-foreground/60"
            style={{ ...delay(1.6), top: `${yPct(weightGoalKg)}%` }}
          >
            <span className="absolute top-1.5 left-0 font-figure text-xs text-muted-foreground">
              Goal {weightGoalKg.toFixed(1)} kg
            </span>
          </div>

          {weightSeries.map((point) =>
            point.scale === null ? null : (
              <span
                key={point.day}
                className="a-fade absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/55 sm:size-1.5"
                style={{
                  ...delay(0.15 + (point.day / LAST_DAY) * WIPE_SECONDS * 0.9),
                  left: `${xPct(point.day)}%`,
                  top: `${yPct(point.scale)}%`,
                }}
              />
            ),
          )}

          <div
            className="a-wipe absolute inset-0"
            style={delay(0.1)}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="size-full overflow-visible"
            >
              <path
                d={trendPath}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>

          {last ? (
            <div
              className="absolute"
              style={{
                left: `${xPct(last.day)}%`,
                top: `${yPct(last.trend)}%`,
              }}
            >
              <span
                className="a-pop absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-4 ring-background"
                style={delay(WIPE_SECONDS)}
              />
              <span
                className="a-fade absolute right-3 bottom-3 font-figure text-sm font-semibold whitespace-nowrap"
                style={delay(WIPE_SECONDS + 0.1)}
              >
                {weightStats.trend} kg
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-5 mr-11">
        {weightMonths.map((month) => (
          <span
            key={month.label}
            className="absolute top-0 text-xs text-muted-foreground"
            style={{ left: `${xPct(month.day)}%` }}
          >
            {month.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BigStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <dt className="eyebrow truncate tracking-[0.08em]">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-figure text-[clamp(1.6rem,6vw,3.25rem)] leading-none font-semibold tracking-tight">
          {value}
        </span>
        {unit ? (
          <span className="text-sm text-muted-foreground">{unit}</span>
        ) : null}
      </dd>
    </div>
  );
}

function Legend() {
  return (
    <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
      <li className="flex items-center gap-2">
        <span className="h-0.5 w-4 rounded-full bg-foreground" />
        Trend
      </li>
      <li className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-muted-foreground/60" />
        Scale readings
      </li>
      <li className="flex items-center gap-2">
        <span className="h-3 w-4 rounded-[3px] bg-foreground/10" />
        How sure the trend is
      </li>
      <li className="flex items-center gap-2">
        <span className="w-4 border-t border-dashed border-muted-foreground" />
        Goal
      </li>
    </ul>
  );
}

export function WeightTrendFeature({
  index,
  more,
}: {
  index?: string;
  more?: SectionLink;
}) {
  return (
    <section
      id="trend"
      aria-labelledby="trend-title"
      className="py-20 sm:py-28"
    >
      <div className={container}>
        <SectionLabel index={index}>Weight trend</SectionLabel>
        <div className="mt-12 grid gap-6 lg:mt-16 lg:grid-cols-2 lg:items-end lg:gap-20">
          <h2 id="trend-title" className={cn(sectionTitle, "reveal max-w-xl")}>
            A trend line, not a daily verdict.
          </h2>
          <div className="reveal flex max-w-xl flex-col gap-6">
            <p className={sectionLead}>
              Scale weight swings with water, salt and timing. Macros draws a
              smoothed trend through your weigh-ins, shades how sure it is, and
              tells you the rate you’re really moving at.
            </p>
            {more ? <MoreLink href={more.href}>{more.label}</MoreLink> : null}
          </div>
        </div>

        <InView className="mt-14 sm:mt-16" threshold={0.25}>
          <figure>
            <dl className="grid grid-cols-3 gap-4 border-t pt-6 sm:gap-8">
              <BigStat label="Trend" value={weightStats.trend} unit="kg" />
              <BigStat label="Per week" value={weightStats.weekly} unit="kg" />
              <BigStat label="3 months" value={weightStats.change} unit="kg" />
            </dl>
            <div className="mt-10" aria-hidden="true">
              <TrendChart />
            </div>
            <figcaption>
              <span className="sr-only">
                Example weight trend over three months, falling from 83.4 to
                78.4 kilograms towards a goal of 75, with daily scale readings
                scattered around the line.
              </span>
              <Legend />
            </figcaption>
          </figure>
        </InView>
      </div>
    </section>
  );
}
