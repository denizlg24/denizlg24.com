import { cn } from "@repo/ui/utils";
import {
  expenditureSeries,
  expenditureStats,
  formatNumber,
} from "@/app/_landing/demo-data";
import { InView } from "@/app/_landing/in-view";
import { delay } from "@/app/_landing/phone/ios";
import { sectionLead, sectionTitle } from "@/app/_landing/sections/feature-row";
import { BigStat } from "@/app/_landing/sections/weight-trend";
import { container, SectionLabel } from "@/app/_landing/site";

const DOMAIN: readonly [number, number] = [1700, 3000];
const TICKS = [2000, 2400, 2800];
const DAYS = expenditureSeries.length;

const xPct = (index: number) => ((index + 0.5) / DAYS) * 100;
const yPct = (kcal: number) =>
  ((DOMAIN[1] - kcal) / (DOMAIN[1] - DOMAIN[0])) * 100;

function path(points: ReadonlyArray<readonly [number, number]>) {
  return points
    .map(
      ([x, y], index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`,
    )
    .join(" ");
}

const estimatePath = path(
  expenditureSeries.map(
    (point, index) => [xPct(index), yPct(point.tdee)] as const,
  ),
);

const rangePath = `${path(
  expenditureSeries.map(
    (point, index) => [xPct(index), yPct(point.high)] as const,
  ),
)} ${path(
  expenditureSeries
    .map((point, index) => [xPct(index), yPct(point.low)] as const)
    .reverse(),
).replace(/^M/, "L")} Z`;

function ExpenditureChart() {
  const last = expenditureSeries.at(-1);
  return (
    <div className="relative h-[260px] sm:h-[320px]">
      <div className="absolute inset-x-0 top-0 bottom-7">
        {TICKS.map((tick) => (
          <div
            key={tick}
            className="absolute inset-x-0 flex items-center gap-3"
            style={{ top: `${yPct(tick)}%` }}
          >
            <span className="h-px flex-1 bg-border" />
            <span className="w-10 -translate-y-px text-right font-figure text-xs text-muted-foreground">
              {formatNumber(tick)}
            </span>
          </div>
        ))}

        <div className="absolute inset-y-0 left-0 right-[3.25rem]">
          {expenditureSeries.map((point, index) => (
            <span
              key={point.day}
              className="a-grow-y absolute bottom-0 w-[1.8%] -translate-x-1/2 rounded-t-[3px] bg-macro-calories/30"
              style={{
                ...delay(0.1 + index * 0.025),
                left: `${xPct(index)}%`,
                height: `${100 - yPct(point.intake)}%`,
              }}
            />
          ))}

          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="a-fade absolute inset-0 size-full overflow-visible"
            style={delay(0.9)}
          >
            <path d={rangePath} fill="currentColor" fillOpacity={0.08} />
          </svg>

          <div className="a-wipe absolute inset-0" style={delay(0.7)}>
            <svg
              aria-hidden="true"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="size-full overflow-visible"
            >
              <path
                d={estimatePath}
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
                left: `${xPct(DAYS - 1)}%`,
                top: `${yPct(last.tdee)}%`,
              }}
            >
              <span
                className="a-pop absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-4 ring-background"
                style={delay(2.8)}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 mr-[3.25rem] flex h-5 justify-between text-xs text-muted-foreground">
        <span>4 weeks ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
      <li className="flex items-center gap-2">
        <span className="h-0.5 w-4 rounded-full bg-foreground" />
        Expenditure estimate
      </li>
      <li className="flex items-center gap-2">
        <span className="h-3 w-4 rounded-[3px] bg-foreground/10" />
        Likely range
      </li>
      <li className="flex items-center gap-2">
        <span className="h-3 w-1.5 rounded-t-[2px] bg-macro-calories/40" />
        Calories eaten
      </li>
    </ul>
  );
}

const NOTES = [
  [
    "The first few weeks",
    "Until there are enough logged days and weigh-ins, the estimate starts from a standard formula and moves toward your own numbers as they arrive.",
  ],
  [
    "Half-logged days",
    "A day you only partly logged counts for less, and an empty day not at all, so a gap can’t drag the estimate down.",
  ],
  [
    "No step bonus",
    "Steps and workouts are context, not extra calories. What you burn already shows up in your trend.",
  ],
] as const;

export function ExpenditureFeature({ index }: { index?: string }) {
  return (
    <section
      id="expenditure"
      aria-labelledby="expenditure-title"
      className="py-20 sm:py-28"
    >
      <div className={container}>
        <SectionLabel index={index}>Expenditure</SectionLabel>
        <div className="mt-12 grid gap-6 lg:mt-16 lg:grid-cols-2 lg:items-end lg:gap-20">
          <h2
            id="expenditure-title"
            className={cn(sectionTitle, "reveal max-w-xl")}
          >
            What you burn, measured.
          </h2>
          <p className={cn(sectionLead, "reveal max-w-xl")}>
            Eat more than you burn and the trend rises; eat less and it falls.
            Macros runs that backwards: from what you ate and how your trend
            moved, it works out what you must have burned — with a range, so you
            know how far to trust it.
          </p>
        </div>

        <InView className="mt-14 sm:mt-16" threshold={0.25}>
          <figure>
            <dl className="grid grid-cols-3 gap-4 border-t pt-6 sm:gap-8">
              <BigStat
                label="Estimate"
                value={expenditureStats.estimate}
                unit="kcal"
              />
              <BigStat
                label="4 weeks"
                value={expenditureStats.change}
                unit="kcal"
              />
              <BigStat
                label="vs formula"
                value={expenditureStats.versusFormula}
              />
            </dl>
            <div className="mt-10" aria-hidden="true">
              <ExpenditureChart />
            </div>
            <figcaption>
              <span className="sr-only">
                Example expenditure estimate over four weeks, rising from about
                2,660 to {expenditureStats.estimate} kcal a day, likely between{" "}
                {expenditureStats.range} kcal, with daily intake around 2,300
                kcal. A standard formula would have said{" "}
                {expenditureStats.formula} kcal.
              </span>
              <Legend />
            </figcaption>
          </figure>
        </InView>

        <dl className="mt-16 grid gap-x-10 sm:mt-20 md:grid-cols-3">
          {NOTES.map(([term, description]) => (
            <div key={term} className="reveal border-t py-5">
              <dt className="text-[15px] font-semibold">{term}</dt>
              <dd className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
                {description}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
