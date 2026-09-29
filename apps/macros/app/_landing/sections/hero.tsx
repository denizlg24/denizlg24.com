import { cn } from "@repo/ui/utils";
import { Check } from "lucide-react";
import {
  demoTargets,
  formatNumber,
  todaysTotals,
} from "@/app/_landing/demo-data";
import { HeroPhone } from "@/app/_landing/hero-phone";
import { withVars } from "@/app/_landing/phone/ios";
import { LogScreen } from "@/app/_landing/screens/log-screen";
import { ProgressScreen } from "@/app/_landing/screens/progress-screen";
import { TodayScreen } from "@/app/_landing/screens/today-screen";
import { container, GetTheApp } from "@/app/_landing/site";

const HIGHLIGHTS = [
  "Free, with no ads",
  "Scan barcodes and labels",
  "Targets that adapt to you",
] as const;

const energySplit = [
  { key: "protein", kcal: todaysTotals.protein * 4 },
  { key: "carbs", kcal: todaysTotals.carbs * 4 },
  { key: "fat", kcal: todaysTotals.fat * 9 },
] as const;

/** Today's energy split as one thin ring: the only colour the page uses. */
function MacroOrbit() {
  const total = energySplit.reduce((sum, part) => sum + part.kcal, 0);
  const gap = 1.4;
  let cursor = 0;
  const arcs = energySplit.map((part, index) => {
    const length = (part.kcal / total) * 100 - gap;
    const arc = { ...part, start: cursor, length, index };
    cursor += length + gap;
    return arc;
  });
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      className="pointer-events-none absolute top-[45%] left-1/2 w-[165%] max-w-none -translate-x-1/2 -translate-y-1/2"
    >
      <circle
        cx="50"
        cy="50"
        r="41"
        fill="none"
        stroke="var(--border)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {arcs.map((arc) => (
        <circle
          key={arc.key}
          cx="50"
          cy="50"
          r="48"
          fill="none"
          stroke={`var(--macro-${arc.key})`}
          strokeWidth="2"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          pathLength={100}
          strokeDasharray={`${arc.length} 200`}
          transform={`rotate(${arc.start * 3.6 - 90} 50 50)`}
          className="a-arc"
          style={withVars({
            "--len": `${arc.length}`,
            "--d": `${0.3 + arc.index * 0.35}s`,
          })}
        />
      ))}
    </svg>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="overflow-x-clip">
      <div
        className={cn(
          container,
          "grid items-center gap-14 pt-10 pb-20 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:pt-14 lg:pb-24",
        )}
      >
        <div className="max-w-[40rem]">
          <p className="eyebrow">Nutrition tracking for iPhone and Android</p>
          <h1
            id="hero-title"
            className="mt-5 text-[clamp(2.1rem,9.4vw,4.1rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance"
          >
            <span className="block">Know what you eat.</span>
            <span className="block text-muted-foreground">
              Learn what you burn.
            </span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted-foreground text-pretty sm:text-xl sm:leading-relaxed">
            Macros logs what you eat in a few taps, draws a weight trend through
            the day-to-day noise, and works out what you actually burn from your
            own logs and weigh-ins — then sets next week’s targets from it.
          </p>
          <div className="mt-9">
            <GetTheApp />
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[15px] font-medium">
            {HIGHLIGHTS.map((highlight) => (
              <li key={highlight} className="flex items-center gap-2">
                <Check
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                  strokeWidth={2.5}
                />
                {highlight}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-center lg:pr-2">
          <div className="relative">
            <MacroOrbit />
            <HeroPhone
              screens={[
                {
                  tab: "today",
                  label: "Today",
                  description: `The Macros Today screen: ${formatNumber(demoTargets.calories - todaysTotals.calories)} kcal left of ${formatNumber(demoTargets.calories)}, protein, carbs and fat meters, habits and the seven-day energy balance.`,
                  content: <TodayScreen />,
                },
                {
                  tab: "log",
                  label: "Log",
                  description:
                    "The Macros food log: a week of calorie rings, the day’s totals, and the day hour by hour, with each food’s calories and macros.",
                  content: <LogScreen />,
                },
                {
                  tab: "progress",
                  label: "Progress",
                  description:
                    "The Macros Progress screen: a three-month weight trend with scale readings, a goal line, and the expenditure estimate.",
                  content: <ProgressScreen />,
                },
              ]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
